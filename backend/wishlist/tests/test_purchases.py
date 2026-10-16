import json
import sqlite3
from unittest.mock import patch

from django.db import OperationalError
from django.db import connections
from django.test import Client, TransactionTestCase

from wishlist.errors import DomainError
from wishlist.models import Purchase, WishlistItem
from wishlist.services.purchases import mark_purchased
from wishlist.tests.helpers import (
    WishlistTestCase,
    hold_sqlite_write_lock,
    make_item,
    make_profile,
    select_profile,
)


class PurchaseTests(WishlistTestCase):
    def setUp(self):
        super().setUp()
    def mark(self, item_id, profile):
        select_profile(self.client, profile)
        return self.client.put(
            f"/api/items/{item_id}/purchase/",
            data="{}",
            content_type="application/json",
            HTTP_X_CSRFTOKEN=self.client.cookies["csrftoken"].value,
        )

    def undo(self, item_id, profile):
        select_profile(self.client, profile)
        return self.client.delete(
            f"/api/items/{item_id}/purchase/",
            HTTP_X_CSRFTOKEN=self.client.cookies["csrftoken"].value,
        )

    def test_single_purchase_conflict_and_repeatable_buyers(self):
        first = self.mark(self.item.pk, self.buyer)
        repeated = self.mark(self.item.pk, self.buyer)
        conflict = self.mark(self.item.pk, self.other)
        self.assertEqual((first.status_code, repeated.status_code), (200, 200))
        self.assertTrue(first.json()["can_undo"])
        self.assertEqual(
            first.json()["purchases"],
            [{"buyer_id": self.buyer.pk, "buyer_name": "Sam"}],
        )
        self.assertEqual(
            (conflict.status_code, conflict.json()["code"]),
            (409, "already_purchased"),
        )
        self.assertEqual(Purchase.objects.filter(item=self.item).count(), 1)

        select_profile(self.client, self.owner)
        edited = self.client.patch(
            f"/api/items/{self.item.pk}/",
            data=json.dumps({"allow_multiple_purchases": True}),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=self.client.cookies["csrftoken"].value,
        )
        self.assertEqual(edited.status_code, 200)
        self.assertNotIn("purchases", edited.json())
        repeatable = self.mark(self.item.pk, self.other)
        self.assertEqual(repeatable.status_code, 200)
        self.assertEqual(
            [purchase["buyer_name"] for purchase in repeatable.json()["purchases"]],
            ["Sam", "Robin"],
        )
        self.assertEqual(Purchase.objects.filter(item=self.item).count(), 2)

        select_profile(self.client, self.owner)
        owner_payload = self.client.get(f"/api/items/{self.item.pk}/").json()
        select_profile(self.client, self.other)
        other_payload = self.client.get(f"/api/items/{self.item.pk}/").json()
        self.assertNotIn("purchases", owner_payload)
        self.assertEqual(
            other_payload["purchases"],
            [
                {"buyer_id": self.buyer.pk, "buyer_name": "Sam"},
                {"buyer_id": self.other.pk, "buyer_name": "Robin"},
            ],
        )

    def test_owner_cannot_mark_regardless_of_purchase_state(self):
        empty = self.mark(self.item.pk, self.owner)
        empty_undo = self.undo(self.item.pk, self.owner)
        Purchase.objects.create(item=self.item, buyer=self.buyer)
        marked = self.mark(self.item.pk, self.owner)
        marked_undo = self.undo(self.item.pk, self.owner)
        statuses = (
            empty.status_code,
            empty_undo.status_code,
            marked.status_code,
            marked_undo.status_code,
        )
        self.assertEqual(statuses, (403, 403, 403, 403))
        self.assertEqual(empty.json()["code"], "forbidden")
        self.assertEqual(marked.json()["code"], "forbidden")
        self.assertEqual(Purchase.objects.filter(item=self.item).count(), 1)

    def test_service_rejects_a_buyer_archived_after_profile_selection(self):
        self.buyer.is_active = False
        self.buyer.save(update_fields=("is_active",))

        with self.assertRaises(DomainError) as caught:
            mark_purchased(self.item.pk, self.buyer)

        self.assertEqual(caught.exception.code, "identity_required")
        self.assertFalse(Purchase.objects.filter(item=self.item).exists())

    def test_undo_is_buyer_owned_and_idempotent(self):
        Purchase.objects.create(item=self.item, buyer=self.buyer)
        Purchase.objects.create(item=self.item, buyer=self.other)
        undo = self.undo(self.item.pk, self.buyer)
        again = self.undo(self.item.pk, self.buyer)
        self.assertEqual((undo.status_code, again.status_code), (200, 200))
        self.assertFalse(Purchase.objects.filter(item=self.item, buyer=self.buyer).exists())
        self.assertTrue(Purchase.objects.filter(item=self.item, buyer=self.other).exists())
        self.assertEqual(undo.json()["updated_at"], self.item.updated_at.isoformat())

    def test_mark_and_undo_leave_persisted_item_timestamps_unchanged(self):
        before = WishlistItem.objects.get(pk=self.item.pk)
        original_created_at = before.created_at
        original_updated_at = before.updated_at

        marked = self.mark(self.item.pk, self.buyer)
        self.item.refresh_from_db()
        self.assertEqual(marked.status_code, 200)
        self.assertEqual(marked.json()["created_at"], original_created_at.isoformat())
        self.assertEqual(marked.json()["updated_at"], original_updated_at.isoformat())
        self.assertEqual(self.item.created_at, original_created_at)
        self.assertEqual(self.item.updated_at, original_updated_at)

        undone = self.undo(self.item.pk, self.buyer)
        self.item.refresh_from_db()
        self.assertEqual(undone.status_code, 200)
        self.assertEqual(undone.json()["created_at"], original_created_at.isoformat())
        self.assertEqual(undone.json()["updated_at"], original_updated_at.isoformat())
        self.assertEqual(self.item.created_at, original_created_at)
        self.assertEqual(self.item.updated_at, original_updated_at)

    def test_disabled_repeatable_item_preserves_marks_but_rejects_new_buyer(self):
        item = make_item(self.owner, name="Many gifts", allow_multiple_purchases=True)
        Purchase.objects.create(item=item, buyer=self.buyer)
        Purchase.objects.create(item=item, buyer=self.other)
        select_profile(self.client, self.owner)
        self.client.patch(
            f"/api/items/{item.pk}/",
            data=json.dumps({"allow_multiple_purchases": False}),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=self.client.cookies["csrftoken"].value,
        )
        third = self.mark(item.pk, self.owner)  # owner denial is independent of history
        select_profile(self.client, self.buyer)
        same_buyer = self.mark(item.pk, self.buyer)
        select_profile(self.client, self.owner)
        self.assertEqual(third.status_code, 403)
        self.assertEqual(same_buyer.status_code, 200)
        self.assertEqual(Purchase.objects.filter(item=item).count(), 2)

        third_buyer = make_profile("taylor", "Taylor")
        conflict = self.mark(item.pk, third_buyer)
        self.assertEqual(
            (conflict.status_code, conflict.json()["code"]),
            (409, "already_purchased"),
        )
        self.assertEqual(Purchase.objects.filter(item=item).count(), 2)

    def test_lock_timeout_rolls_back_and_unrelated_database_errors_propagate(self):
        from wishlist.services.purchases import mark_purchased

        real_create = Purchase.objects.create

        def create_then_timeout(*args, **kwargs):
            real_create(*args, **kwargs)
            error = OperationalError("database is locked")
            error.__cause__ = sqlite3.OperationalError("database is locked")
            raise error

        with patch(
            "wishlist.services.purchases.Purchase.objects.create",
            side_effect=create_then_timeout,
        ):
            response = self.mark(self.item.pk, self.buyer)
        self.assertEqual((response.status_code, response.json()["code"]), (503, "database_busy"))
        self.assertFalse(Purchase.objects.filter(item=self.item).exists())

        unrelated = OperationalError("no such table: purchase_archive")
        unrelated.__cause__ = sqlite3.OperationalError("no such table: purchase_archive")
        with patch("wishlist.services.purchases.Purchase.objects.filter", side_effect=unrelated):
            with self.assertRaises(OperationalError) as caught:
                mark_purchased(self.item.pk, self.buyer)
        self.assertIs(caught.exception, unrelated)


class PurchaseLockTests(TransactionTestCase):
    def setUp(self):
        self.owner = make_profile("lock-owner", "Lock owner")
        self.buyer = make_profile("lock-buyer", "Lock buyer")
        self.item = make_item(self.owner, name="Gift", allow_multiple_purchases=True)
        self.client = Client(enforce_csrf_checks=True, raise_request_exception=False)
        select_profile(self.client, self.buyer)
        self.csrf = self.client.cookies["csrftoken"].value

    def test_purchase_lock_timeout_is_retryable_and_has_no_mark(self):
        sqlite_codes = []

        def capture_sqlite_error(execute, sql, params, many, context):
            try:
                return execute(sql, params, many, context)
            except Exception as exc:
                cause = exc.__cause__
                if cause is not None and hasattr(cause, "sqlite_errorcode"):
                    sqlite_codes.append(cause.sqlite_errorcode)
                raise

        with hold_sqlite_write_lock(self.item.pk):
            with connections["default"].execute_wrapper(capture_sqlite_error):
                response = self.client.put(
                    f"/api/items/{self.item.pk}/purchase/",
                    data="{}",
                    content_type="application/json",
                    HTTP_X_CSRFTOKEN=self.csrf,
                )

        self.assertTrue(
            any((code & 0xFF) == sqlite3.SQLITE_BUSY for code in sqlite_codes),
            f"expected actual SQLITE_BUSY error code, got {sqlite_codes}",
        )
        self.assertEqual((response.status_code, response.json()["code"]), (503, "database_busy"))
        self.assertFalse(Purchase.objects.filter(item=self.item).exists())

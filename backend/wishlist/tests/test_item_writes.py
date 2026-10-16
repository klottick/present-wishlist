import json
import sqlite3
from unittest.mock import patch

from django.db import connections
from django.test import Client, TransactionTestCase

from wishlist.models import Purchase, WishlistItem
from wishlist.services.items import create_item as create_item_service
from wishlist.tests.helpers import (
    WishlistTestCase,
    hold_sqlite_write_lock,
    make_event,
    make_item,
    make_profile,
    select_profile,
)


class RepeatabilityPatchLockTests(TransactionTestCase):
    def setUp(self):
        self.owner = make_profile("patch-owner", "Patch owner")
        self.item = make_item(
            self.owner, name="Gift", allow_multiple_purchases=True
        )
        self.client = Client(enforce_csrf_checks=True, raise_request_exception=False)
        select_profile(self.client, self.owner)
        self.csrf = self.client.cookies["csrftoken"].value

    def test_patch_lock_timeout_returns_retryable_503_without_partial_change(self):
        original = WishlistItem.objects.get(pk=self.item.pk)
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
                response = self.client.patch(
                    f"/api/items/{self.item.pk}/",
                    data=json.dumps({"allow_multiple_purchases": False}),
                    content_type="application/json",
                    HTTP_X_CSRFTOKEN=self.csrf,
                )

        self.assertTrue(
            any((code & 0xFF) == sqlite3.SQLITE_BUSY for code in sqlite_codes),
            f"expected actual SQLite busy/locked error code, got {sqlite_codes}",
        )
        self.assertEqual((response.status_code, response.json()["code"]), (503, "database_busy"))
        self.item.refresh_from_db()
        self.assertTrue(self.item.allow_multiple_purchases)
        self.assertEqual(self.item.created_at, original.created_at)
        self.assertEqual(self.item.updated_at, original.updated_at)


class ItemWriteTests(WishlistTestCase):
    def setUp(self):
        super().setUp()
        self.csrf = self.client.cookies["csrftoken"].value

    def post_item(self, data):
        return self.client.post(
            "/api/items/",
            data=json.dumps(data),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=self.csrf,
        )

    def test_create_route_derives_owner_from_current_profile(self):
        response = self.client.post(
            "/api/items/",
            data=json.dumps({"name": "Root route gift"}),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=self.csrf,
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["owner_id"], self.owner.pk)

    def test_every_unsafe_api_write_requires_csrf_and_leaves_state_unchanged(self):
        repeatable = make_item(
            self.owner, name="Repeatable", allow_multiple_purchases=True
        )
        unmarked = make_item(
            self.owner, name="Unmarked", allow_multiple_purchases=True
        )
        existing_mark = Purchase.objects.create(item=repeatable, buyer=self.buyer)

        writes = [
            ("session select", lambda: self.client.put(
                "/api/session/", data=json.dumps({"profile_id": self.buyer.pk}),
                content_type="application/json",
            )),
            ("session clear", lambda: self.client.delete("/api/session/")),
            ("item create", lambda: self.client.post(
                "/api/items/", data=json.dumps({"name": "Must not be created"}),
                content_type="application/json",
            )),
            ("item update", lambda: self.client.patch(
                f"/api/items/{self.item.pk}/", data=json.dumps({"name": "Changed"}),
                content_type="application/json",
            )),
            ("item delete", lambda: self.client.delete(f"/api/items/{self.item.pk}/")),
        ]
        for name, send in writes:
            with self.subTest(operation=name):
                response = send()
                self.assertEqual((response.status_code, response.json()["code"]), (403, "csrf_failed"))
                self.assertTrue(response["Content-Type"].startswith("application/json"))
                self.assertEqual(response["Cache-Control"], "no-store")

        self.assertEqual(self.client.get("/api/session/").json()["profile"]["id"], self.owner.pk)
        self.assertEqual(self.owner.items.count(), 3)
        self.item.refresh_from_db()
        self.assertEqual(self.item.name, "A book")
        self.assertFalse(self.owner.items.filter(name="Must not be created").exists())

        select_profile(self.client, self.buyer)
        purchase_writes = [
            ("purchase mark", lambda: self.client.put(
                f"/api/items/{unmarked.pk}/purchase/", data="{}",
                content_type="application/json",
            )),
            ("purchase undo", lambda: self.client.delete(
                f"/api/items/{repeatable.pk}/purchase/",
            )),
        ]
        for name, send in purchase_writes:
            with self.subTest(operation=name):
                response = send()
                self.assertEqual((response.status_code, response.json()["code"]), (403, "csrf_failed"))
                self.assertTrue(response["Content-Type"].startswith("application/json"))
                self.assertEqual(response["Cache-Control"], "no-store")

        self.assertEqual(self.client.get("/api/session/").json()["profile"]["id"], self.buyer.pk)
        self.assertFalse(Purchase.objects.filter(item=unmarked).exists())
        self.assertTrue(Purchase.objects.filter(pk=existing_mark.pk).exists())

    def test_nested_profile_items_route_is_read_only(self):
        response = self.client.post(
            f"/api/profiles/{self.owner.pk}/items/",
            data=json.dumps({"name": "Should not be created"}),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=self.csrf,
        )

        self.assertEqual(response.status_code, 405)
        self.assertFalse(self.owner.items.filter(name="Should not be created").exists())

    def patch_item(self, item_id, data):
        return self.client.patch(
            f"/api/items/{item_id}/",
            data=json.dumps(data),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=self.csrf,
        )

    def delete_item(self, item_id):
        return self.client.delete(
            f"/api/items/{item_id}/", HTTP_X_CSRFTOKEN=self.csrf
        )

    def test_create_defaults_and_owner_only_edit(self):
        created = self.post_item({"name": "  A book  "})
        payload = created.json()

        self.assertEqual((created.status_code, payload["name"]), (201, "A book"))
        self.assertIsNone(payload["event"])
        self.assertFalse(payload["allow_multiple_purchases"])
        self.assertEqual((payload["link"], payload["price"], payload["notes"]), ("", "", ""))
        self.assertTrue(payload["is_owner"])
        self.assertNotIn("purchases", payload)
        self.assertNotIn("buyer_id", payload)
        self.assertNotIn("can_purchase", payload)

        item = make_item(self.owner, name="Keep unchanged")
        select_profile(self.client, self.other)
        forbidden_edit = self.patch_item(item.pk, {"name": "Changed"})
        forbidden_delete = self.delete_item(item.pk)
        item.refresh_from_db()

        self.assertEqual((forbidden_edit.status_code, forbidden_delete.status_code), (403, 403))
        self.assertEqual(item.name, "Keep unchanged")

    def test_reject_read_only_unknown_and_unsafe_fields(self):
        bad_payloads = (
            {"name": "Book", "owner_id": self.other.pk},
            {"name": "Book", "purchases": []},
            {"name": "Book", "buyer_id": self.buyer.pk},
            {"name": "Book", "unexpected": True},
            {"name": "Book", "link": "javascript:alert(1)"},
            {"name": 42},
        )
        for data in bad_payloads:
            with self.subTest(data=data):
                response = self.post_item(data)
                self.assertEqual(response.status_code, 400)
        self.assertEqual(self.owner.items.count(), 1)

    def test_all_field_limits_and_invalid_types(self):
        for field, limit in (("name", 200), ("link", 2000), ("price", 80), ("notes", 5000)):
            with self.subTest(field=field):
                too_long = {"name": "Book", field: "x" * (limit + 1)}
                self.assertEqual(self.post_item(too_long).status_code, 400)

        self.assertEqual(
            self.post_item({"name": "Book", "link": "https://example.com/gift"}).status_code,
            201,
        )
        self.assertEqual(
            self.post_item({"name": "Book", "link": "http://example.com/gift"}).status_code,
            201,
        )
        for field, value in (
            ("link", None),
            ("price", 12),
            ("notes", ["note"]),
            ("allow_multiple_purchases", 1),
            ("event_id", True),
        ):
            with self.subTest(field=field, value=value):
                self.assertEqual(self.post_item({"name": "Book", field: value}).status_code, 400)

    def test_create_revalidates_event_inside_transaction(self):
        event = make_event("birthday", "Birthday")

        def archive_before_service(owner, data):
            event.is_active = False
            event.save(update_fields=("is_active",))
            return create_item_service(owner, data)

        with patch("wishlist.api.items.create_item", side_effect=archive_before_service):
            response = self.post_item({"name": "Birthday gift", "event_id": event.pk})

        self.assertEqual(response.status_code, 400)
        self.assertFalse(self.owner.items.filter(name="Birthday gift").exists())

    def test_keep_archived_event_but_reject_new_assignment(self):
        archived = make_event("old-event", "Old Event", active=False)
        item = make_item(self.owner, name="Old gift", event=archived)

        retained = self.patch_item(item.pk, {"notes": "still wanted"})
        rejected_create = self.post_item({"name": "New", "event_id": archived.pk})
        another_item = make_item(self.owner, name="Another gift")
        rejected_change = self.patch_item(another_item.pk, {"event_id": archived.pk})

        self.assertEqual(retained.status_code, 200)
        self.assertEqual(retained.json()["event"]["id"], archived.pk)
        self.assertEqual(rejected_create.status_code, 400)
        self.assertEqual(rejected_change.status_code, 400)

    def test_event_change_preserves_purchase_ids(self):
        event = make_event("birthday", "Birthday")
        item = make_item(self.owner, name="Gift")
        marks = [Purchase.objects.create(item=item, buyer=profile) for profile in (self.buyer, self.other)]

        response = self.patch_item(item.pk, {"event_id": event.pk})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["event"]["id"], event.pk)
        self.assertEqual(
            set(Purchase.objects.filter(item=item).values_list("pk", flat=True)),
            {mark.pk for mark in marks},
        )

    def test_toggle_off_preserves_multiple_marks_without_leaking(self):
        item = make_item(self.owner, name="Gift", allow_multiple_purchases=True)
        for profile in (self.buyer, self.other):
            Purchase.objects.create(item=item, buyer=profile)

        response = self.patch_item(item.pk, {"allow_multiple_purchases": False})

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["allow_multiple_purchases"])
        self.assertNotIn("purchases", response.json())
        self.assertEqual(Purchase.objects.filter(item=item).count(), 2)

    def test_create_patch_and_delete_have_no_recipient_spoilers(self):
        created = self.post_item({"name": "Gift"})
        item_id = created.json()["id"]
        owner_before_marks = created.json()
        Purchase.objects.create(item_id=item_id, buyer=self.buyer)
        owner_after_marks = self.client.get(f"/api/items/{item_id}/").json()

        self.assertEqual(owner_after_marks, owner_before_marks)

        edited = self.patch_item(item_id, {"name": "Updated gift"})
        deleted = self.delete_item(item_id)

        self.assertEqual(edited.status_code, 200)
        edited_payload = edited.json()
        expected_patch = {
            **owner_before_marks,
            "name": "Updated gift",
            "updated_at": edited_payload["updated_at"],
        }
        self.assertEqual(edited_payload, expected_patch)
        self.assertEqual(deleted.status_code, 204)
        self.assertEqual(deleted.content, b"")
        self.assertFalse(self.owner.items.filter(pk=item_id).exists())

    def test_purchase_activity_does_not_change_item_timestamp(self):
        item = make_item(self.owner, name="Gift")
        initial = self.client.get(f"/api/items/{item.pk}/").json()["updated_at"]
        Purchase.objects.create(item=item, buyer=self.buyer)

        response = self.client.get(f"/api/items/{item.pk}/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["updated_at"], initial)

    def test_owner_can_edit_repeatability_and_delete_a_purchased_item(self):
        item = make_item(self.owner, name="Already marked", allow_multiple_purchases=False)
        Purchase.objects.create(item=item, buyer=self.buyer)

        edited = self.patch_item(item.pk, {"allow_multiple_purchases": True})
        deleted = self.delete_item(item.pk)

        self.assertEqual(edited.status_code, 200)
        self.assertTrue(edited.json()["allow_multiple_purchases"])
        self.assertNotIn("purchases", edited.json())
        self.assertEqual(deleted.status_code, 204)

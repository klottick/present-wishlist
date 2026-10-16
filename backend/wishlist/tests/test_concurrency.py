import threading
import sqlite3

from django.db import close_old_connections
from django.test import TransactionTestCase

from wishlist.errors import DomainError
from wishlist.models import FamilyProfile, Purchase, WishlistItem
from wishlist.services.items import update_item
from wishlist.services.purchases import mark_purchased
from wishlist.tests.helpers import hold_sqlite_write_lock, make_item, make_profile


class ConcurrencyTests(TransactionTestCase):
    reset_sequences = True

    def setUp(self):
        self.owner = make_profile("alex", "Alex")
        self.buyer = make_profile("sam", "Sam")
        self.other = make_profile("robin", "Robin")
        self.item = make_item(self.owner, name="Gift")

    def race(self, operations):
        barrier = threading.Barrier(len(operations))
        results = []
        errors = []

        def run(operation):
            close_old_connections()
            try:
                profile_id, callback = operation
                profile = FamilyProfile.objects.get(pk=profile_id)
                barrier.wait(timeout=5)
                results.append(callback(profile))
            except Exception as exc:
                errors.append(exc)
            finally:
                close_old_connections()

        threads = [threading.Thread(target=run, args=(operation,)) for operation in operations]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)
        self.assertFalse(any(thread.is_alive() for thread in threads), "worker thread hung")
        self.assertEqual(errors, [])
        return results

    def mark_result(self, item_id):
        def mark(profile):
            try:
                mark_purchased(item_id, profile)
                return "success"
            except DomainError as exc:
                return exc.code

        return mark

    def test_two_simultaneous_buyers_only_one_wins(self):
        results = self.race(
            [(self.buyer.pk, self.mark_result(self.item.pk)), (self.other.pk, self.mark_result(self.item.pk))]
        )
        self.assertCountEqual(results, ["success", "already_purchased"])
        self.assertEqual(Purchase.objects.filter(item=self.item).count(), 1)

    def test_toggle_and_purchase_are_serialized(self):
        self.item.allow_multiple_purchases = True
        self.item.save(update_fields=("allow_multiple_purchases",))
        Purchase.objects.create(item=self.item, buyer=self.buyer)

        def disable(profile):
            update_item(self.item.pk, profile, {"allow_multiple_purchases": False})
            return "disabled"

        results = self.race(
            [(self.owner.pk, disable), (self.other.pk, self.mark_result(self.item.pk))]
        )
        self.assertEqual(results.count("disabled"), 1)
        self.assertIn(
            next(result for result in results if result != "disabled"),
            ("success", "already_purchased"),
        )
        item = WishlistItem.objects.get(pk=self.item.pk)
        self.assertFalse(item.allow_multiple_purchases)
        expected_mark_count = 2 if "success" in results else 1
        self.assertEqual(Purchase.objects.filter(item=item).count(), expected_mark_count)
        third = make_profile("taylor", "Taylor")
        with self.assertRaises(DomainError) as caught:
            mark_purchased(item.pk, third)
        self.assertEqual(caught.exception.code, "already_purchased")

    def test_simultaneous_same_buyer_mark_is_idempotent(self):
        results = self.race(
            [(self.buyer.pk, self.mark_result(self.item.pk)), (self.buyer.pk, self.mark_result(self.item.pk))]
        )
        self.assertEqual(results, ["success", "success"])
        self.assertEqual(Purchase.objects.filter(item=self.item, buyer=self.buyer).count(), 1)

    def test_repeatable_item_accepts_concurrent_different_buyers(self):
        self.item.allow_multiple_purchases = True
        self.item.save(update_fields=("allow_multiple_purchases",))
        results = self.race(
            [(self.buyer.pk, self.mark_result(self.item.pk)), (self.other.pk, self.mark_result(self.item.pk))]
        )
        self.assertEqual(results, ["success", "success"])
        self.assertEqual(Purchase.objects.filter(item=self.item).count(), 2)

    def test_real_sqlite_busy_timeout_is_normalized_with_engine_error_code(self):
        with hold_sqlite_write_lock(self.item.pk):
            with self.assertRaises(DomainError) as caught:
                mark_purchased(self.item.pk, self.buyer)

        self.assertEqual(caught.exception.code, "database_busy")
        sqlite_error = caught.exception.__cause__.__cause__
        self.assertEqual(sqlite_error.sqlite_errorcode, sqlite3.SQLITE_BUSY)
        self.assertFalse(Purchase.objects.filter(item=self.item).exists())

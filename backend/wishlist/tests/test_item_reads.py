from datetime import datetime, timezone

from wishlist.models import Purchase, WishlistItem
from wishlist.tests.helpers import (
    WishlistTestCase,
    make_event,
    make_item,
    select_profile,
)


class ItemReadTests(WishlistTestCase):
    def setUp(self):
        super().setUp()
        self.birthday = make_event("birthday", "Birthday")
        self.christmas = make_event("christmas", "Christmas")
        self.all_saints = make_event("all", "All Saints Day")
        self.archived = make_event("old-event", "Old Event", active=False)

    def list_items(self, owner=None, event=None):
        params = {}
        if event is not None:
            params["event"] = event
        return self.client.get(f"/api/profiles/{(owner or self.owner).pk}/items/", params)

    def test_owner_payload_omits_purchase_fields(self):
        repeatable = make_item(
            self.owner, name="Repeatable", allow_multiple_purchases=True
        )
        before = self.list_items().json()
        Purchase.objects.create(item=repeatable, buyer=self.buyer)

        response = self.list_items()
        detail = self.client.get(f"/api/items/{repeatable.pk}/")
        payload = next(item for item in response.json() if item["id"] == repeatable.pk)
        expected_keys = {
            "id", "owner_id", "name", "link", "price", "notes", "event",
            "allow_multiple_purchases", "created_at", "updated_at", "is_owner",
        }
        self.assertEqual(response.status_code, 200)
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(set(payload), expected_keys)
        self.assertEqual(set(detail.json()), expected_keys)
        self.assertNotIn("purchases", payload)
        self.assertNotIn("buyer_name", str(payload))
        self.assertNotIn("buyer_id", str(payload))
        self.assertNotIn("can_purchase", payload)
        self.assertNotIn("can_undo", payload)

        old_timestamp = payload["updated_at"]
        old_order = [item["id"] for item in response.json()]
        Purchase.objects.create(item=repeatable, buyer=self.other)
        after = self.list_items().json()
        after_payload = next(item for item in after if item["id"] == repeatable.pk)
        self.assertEqual(after_payload["updated_at"], old_timestamp)
        self.assertEqual([item["id"] for item in after], old_order)
        self.assertEqual(
            next(item for item in before if item["id"] == repeatable.pk)["updated_at"],
            old_timestamp,
        )

    def test_specific_event_includes_anything(self):
        birthday_item = make_item(self.owner, name="Birthday", event=self.birthday)
        anything_item = make_item(self.owner, name="Anything")
        christmas_item = make_item(self.owner, name="Christmas", event=self.christmas)
        archived_item = make_item(self.owner, name="Archived", event=self.archived)

        response = self.list_items(event="birthday")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            {item["id"] for item in response.json()},
            {birthday_item.pk, anything_item.pk, self.item.pk},
        )
        self.assertNotIn(christmas_item.pk, {item["id"] for item in response.json()})
        self.assertNotIn(archived_item.pk, {item["id"] for item in response.json()})

    def test_anything_only_and_omitted_filter_means_all_events(self):
        birthday_item = make_item(self.owner, name="Birthday", event=self.birthday)
        anything_item = make_item(self.owner, name="Anything")
        christmas_item = make_item(self.owner, name="Christmas", event=self.christmas)
        all_saints_item = make_item(self.owner, name="All Saints", event=self.all_saints)
        archived_item = make_item(self.owner, name="Archived", event=self.archived)

        anything = self.list_items(event="anything")
        all_items = self.list_items()

        self.assertEqual(
            {item["id"] for item in anything.json()},
            {anything_item.pk, self.item.pk},
        )
        self.assertEqual(
            {item["id"] for item in all_items.json()},
            {birthday_item.pk, anything_item.pk, christmas_item.pk, all_saints_item.pk, archived_item.pk, self.item.pk},
        )
        archived_payload = next(item for item in all_items.json() if item["id"] == archived_item.pk)
        self.assertEqual(archived_payload["event"]["label"], "Old Event")
        self.assertFalse(archived_payload["event"]["is_active"])

    def test_configured_all_key_filters_like_any_other_active_event(self):
        saints_item = make_item(self.owner, name="All Saints", event=self.all_saints)
        anything_item = make_item(self.owner, name="Anything gift")
        birthday_item = make_item(self.owner, name="Birthday gift", event=self.birthday)

        response = self.list_items(event="all")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            {item["id"] for item in response.json()},
            {saints_item.pk, anything_item.pk, self.item.pk},
        )
        self.assertNotIn(birthday_item.pk, {item["id"] for item in response.json()})

    def test_inactive_configured_all_key_is_rejected(self):
        self.all_saints.is_active = False
        self.all_saints.save(update_fields=("is_active",))

        response = self.list_items(event="all")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "validation_error")

    def test_unconfigured_all_key_is_rejected(self):
        self.all_saints.config_key = "saints"
        self.all_saints.save(update_fields=("config_key",))

        response = self.list_items(event="all")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "validation_error")

    def test_unknown_or_inactive_filter_is_400(self):
        for event_key in ("not-configured", self.archived.config_key):
            with self.subTest(event=event_key):
                response = self.list_items(event=event_key)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["code"], "validation_error")

    def test_archived_owner_is_not_browsable(self):
        self.owner.is_active = False
        self.owner.save(update_fields=("is_active",))
        select_profile(self.client, self.other)

        response = self.list_items()
        detail = self.client.get(f"/api/items/{self.item.pk}/")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["code"], "not_found")
        self.assertEqual(detail.status_code, 404)

    def test_archived_buyer_name_remains_visible(self):
        item = make_item(self.owner, name="Gift")
        Purchase.objects.create(item=item, buyer=self.buyer)
        self.buyer.is_active = False
        self.buyer.save(update_fields=("is_active",))
        select_profile(self.client, self.other)

        response = self.client.get(f"/api/items/{item.pk}/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["purchases"], [
            {"buyer_id": self.buyer.pk, "buyer_name": "Sam"}
        ])

    def test_nonowner_sees_buyers_and_own_undo_capability(self):
        item = make_item(self.owner, name="Gift")
        Purchase.objects.create(item=item, buyer=self.buyer)
        select_profile(self.client, self.other)

        response = self.client.get(f"/api/items/{item.pk}/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["purchases"], [
            {"buyer_id": self.buyer.pk, "buyer_name": "Sam"}
        ])
        self.assertFalse(payload["can_purchase"])
        self.assertFalse(payload["can_undo"])

    def test_buyer_can_undo_own_mark(self):
        item = make_item(self.owner, name="Gift")
        Purchase.objects.create(item=item, buyer=self.buyer)
        select_profile(self.client, self.buyer)

        response = self.client.get(f"/api/items/{item.pk}/")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["can_undo"])

    def test_empty_and_repeatable_items_are_purchasable(self):
        ordinary = make_item(self.owner, name="Ordinary")
        repeatable = make_item(
            self.owner, name="Repeatable", allow_multiple_purchases=True
        )
        select_profile(self.client, self.buyer)

        ordinary_payload = self.client.get(f"/api/items/{ordinary.pk}/").json()
        repeatable_payload = self.client.get(f"/api/items/{repeatable.pk}/").json()

        self.assertTrue(ordinary_payload["can_purchase"])
        self.assertEqual(ordinary_payload["purchases"], [])
        self.assertTrue(repeatable_payload["can_purchase"])
        self.assertEqual(repeatable_payload["purchases"], [])

    def test_equal_timestamp_item_and_buyer_order_is_deterministic(self):
        first = make_item(self.owner, name="First")
        second = make_item(self.owner, name="Second")
        tied = datetime(2026, 1, 1, tzinfo=timezone.utc)
        WishlistItem.objects.filter(pk__in=(first.pk, second.pk)).update(created_at=tied)
        Purchase.objects.create(item=first, buyer=self.other)
        Purchase.objects.create(item=first, buyer=self.buyer)
        Purchase.objects.filter(item=first).update(created_at=tied)
        select_profile(self.client, self.other)

        items = self.list_items().json()
        first_payload = next(item for item in items if item["id"] == first.pk)
        self.assertEqual(
            [item["id"] for item in items if item["id"] in (first.pk, second.pk)],
            [second.pk, first.pk],
        )
        self.assertEqual(
            [purchase["buyer_id"] for purchase in first_payload["purchases"]],
            [self.other.pk, self.buyer.pk],
        )

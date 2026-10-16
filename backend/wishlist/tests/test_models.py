from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.db.models.deletion import ProtectedError
from django.test import TestCase, TransactionTestCase

from wishlist.models import Event, FamilyProfile, Purchase, WishlistItem


class ModelTests(TestCase):
    def test_item_defaults_and_future_login_link(self):
        profile = FamilyProfile.objects.create(config_key="alex", name="Alex")
        item = WishlistItem.objects.create(owner=profile, name="A book")

        self.assertIsNone(profile.user_id)
        self.assertIsNone(item.event_id)
        self.assertFalse(item.allow_multiple_purchases)
        self.assertEqual((item.link, item.price, item.notes), ("", "", ""))

    def test_duplicate_buyer_is_database_rejected(self):
        owner = FamilyProfile.objects.create(config_key="alex", name="Alex")
        buyer = FamilyProfile.objects.create(config_key="sam", name="Sam")
        item = WishlistItem.objects.create(owner=owner, name="A book")
        Purchase.objects.create(item=item, buyer=buyer)

        with self.assertRaises(IntegrityError):
            Purchase.objects.create(item=item, buyer=buyer)

    def test_item_deletion_cascades_purchase(self):
        owner = FamilyProfile.objects.create(config_key="alex", name="Alex")
        buyer = FamilyProfile.objects.create(config_key="sam", name="Sam")
        item = WishlistItem.objects.create(owner=owner, name="A book")
        purchase = Purchase.objects.create(item=item, buyer=buyer)

        item.delete()

        self.assertFalse(Purchase.objects.filter(pk=purchase.pk).exists())

    def test_user_link_is_optional_unique_and_preserves_profile_on_user_deletion(self):
        user = get_user_model().objects.create_user(username="alex")
        profile = FamilyProfile.objects.create(
            config_key="alex", name="Alex", user=user
        )

        with self.assertRaises(IntegrityError), transaction.atomic():
            FamilyProfile.objects.create(config_key="alex-2", name="Alex 2", user=user)

        user.delete()
        profile.refresh_from_db()

        self.assertTrue(FamilyProfile.objects.filter(pk=profile.pk).exists())
        self.assertIsNone(profile.user_id)


class ProtectedReferenceDatabaseTests(TransactionTestCase):
    def test_database_backed_delete_protects_profile_references(self):
        owner = FamilyProfile.objects.create(config_key="owner", name="Owner")
        buyer = FamilyProfile.objects.create(config_key="buyer", name="Buyer")
        item = WishlistItem.objects.create(owner=owner, name="Gift")
        Purchase.objects.create(item=item, buyer=buyer)

        with self.assertRaises(ProtectedError):
            owner.delete()
        with self.assertRaises(ProtectedError):
            buyer.delete()

        self.assertTrue(FamilyProfile.objects.filter(pk=owner.pk).exists())
        self.assertTrue(FamilyProfile.objects.filter(pk=buyer.pk).exists())

    def test_database_backed_delete_protects_event_assignments(self):
        owner = FamilyProfile.objects.create(config_key="owner", name="Owner")
        event = Event.objects.create(config_key="birthday", label="Birthday")
        item = WishlistItem.objects.create(owner=owner, event=event, name="Gift")

        with self.assertRaises(ProtectedError):
            event.delete()

        item.refresh_from_db()
        self.assertEqual(item.event_id, event.pk)

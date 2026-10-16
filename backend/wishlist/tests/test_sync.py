from pathlib import Path
from tempfile import TemporaryDirectory

from django.core.management import call_command, CommandError
from django.contrib.auth import get_user_model
from django.test import TestCase

from wishlist.configuration.loader import FamilyConfig
from wishlist.configuration.sync import sync_family_config
from wishlist.models import Event, FamilyProfile, Purchase, WishlistItem


class SyncTests(TestCase):
    def test_rename_remove_reactivate_preserves_identity(self):
        sync_family_config(
            FamilyConfig(members={"alex": "Alex"}, events={"birthday": "Birthday"})
        )
        profile = FamilyProfile.objects.get(config_key="alex")
        event = Event.objects.get(config_key="birthday")
        user = get_user_model().objects.create_user(username="alex")
        profile.user = user
        profile.save(update_fields=("user",))
        item = WishlistItem.objects.create(owner=profile, name="A book", event=event)
        purchase = Purchase.objects.create(item=item, buyer=profile)
        original_identity = (profile.pk, profile.user_id)
        original_record_ids = (profile.pk, event.pk, item.pk, purchase.pk)
        original_marks = list(Purchase.objects.values_list("pk", flat=True))

        sync_family_config(FamilyConfig(members={}, events={}))
        profile.refresh_from_db()
        event.refresh_from_db()
        self.assertFalse(profile.is_active)
        self.assertFalse(event.is_active)
        sync_family_config(
            FamilyConfig(members={"alex": "Alexander"}, events={"birthday": "Bday"})
        )

        profile.refresh_from_db()
        event.refresh_from_db()
        item.refresh_from_db()
        purchase.refresh_from_db()
        self.assertEqual((profile.pk, profile.user_id), original_identity)
        self.assertEqual(
            (profile.pk, event.pk, item.pk, purchase.pk), original_record_ids
        )
        self.assertEqual(list(Purchase.objects.values_list("pk", flat=True)), original_marks)
        self.assertEqual(
            (item.pk, purchase.item_id, purchase.pk),
            (original_record_ids[2], original_record_ids[2], original_record_ids[3]),
        )
        self.assertEqual((profile.name, event.label), ("Alexander", "Bday"))
        self.assertTrue(profile.is_active)
        self.assertTrue(event.is_active)

    def test_sync_is_idempotent(self):
        config = FamilyConfig(members={"alex": "Alex"}, events={"birthday": "Birthday"})
        sync_family_config(config)
        first = (
            FamilyProfile.objects.get(config_key="alex").pk,
            Event.objects.get(config_key="birthday").pk,
        )

        sync_family_config(config)

        self.assertEqual(
            (
                FamilyProfile.objects.get(config_key="alex").pk,
                Event.objects.get(config_key="birthday").pk,
            ),
            first,
        )

    def test_archived_labels_are_preserved_until_reactivation(self):
        sync_family_config(FamilyConfig(members={"alex": "Alex"}, events={}))
        sync_family_config(FamilyConfig(members={}, events={}))

        archived = FamilyProfile.objects.get(config_key="alex")
        self.assertFalse(archived.is_active)
        self.assertEqual(archived.name, "Alex")

    def test_invalid_config_leaves_database_unchanged(self):
        sync_family_config(FamilyConfig(members={"alex": "Alex"}, events={}))
        with TemporaryDirectory() as directory:
            path = Path(directory) / "bad.yaml"
            path.write_text(
                "members:\n  sam: Sam\nevents:\n  invalid: 2026-99-99\n",
                encoding="utf-8",
            )
            with self.assertRaises(CommandError):
                call_command("sync_family_config", config=str(path))

        self.assertEqual(
            list(FamilyProfile.objects.values_list("config_key", "name")),
            [("alex", "Alex")],
        )
        self.assertFalse(Event.objects.exists())

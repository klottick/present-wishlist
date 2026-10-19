from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urlparse
from unittest.mock import patch

from django.core.management import call_command, CommandError
from django.test import TestCase, override_settings

from wishlist.models import Event, FamilyProfile, Purchase, WishlistItem
from wishlist.tests.helpers import make_item, make_profile


class DemoCommandTests(TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.config_path = Path(self.temp.name) / "family.yaml"
        self.config_path.write_text(
            "members:\n  alex: Alex\n  sam: Sam\nevents:\n  birthday: Birthday\n",
            encoding="utf-8",
        )
        self.settings = override_settings(FAMILY_CONFIG_PATH=self.config_path)
        self.settings.enable()

    def tearDown(self):
        self.settings.disable()
        self.temp.cleanup()

    def seed(self):
        call_command("seed_demo", stdout=None)

    def test_seed_is_repeatable_and_uses_configured_profiles_and_events(self):
        make_profile("alex", "Alex")
        make_profile("sam", "Sam")
        Event.objects.create(config_key="birthday", label="Birthday")
        self.seed()
        first = list(WishlistItem.objects.filter(demo_key__isnull=False).order_by("demo_key"))
        self.seed()
        self.assertEqual(WishlistItem.objects.filter(demo_key__isnull=False).count(), len(first))
        self.assertEqual(len(first), 4)
        self.assertTrue(all(item.owner_id in [p.pk for p in FamilyProfile.objects.all()] for item in first))
        self.assertTrue(all(urlparse(item.link).hostname.endswith(".example.com") for item in first))
        self.assertEqual(
            [item.purchases.get().buyer.config_key for item in first],
            ["sam", "alex", "sam", "alex"],
        )
        self.assertTrue(all(not Purchase.objects.filter(item=item, buyer_id=item.owner_id).exists() for item in first))
        self.assertEqual(FamilyProfile.objects.count(), 2)
        self.assertEqual(Event.objects.count(), 1)

    def test_seed_preserves_ordinary_and_edited_demo_records(self):
        owner = make_profile("alex", "Alex")
        make_profile("sam", "Sam")
        ordinary = make_item(owner, name="A real gift")
        self.seed()
        demo = WishlistItem.objects.filter(demo_key__isnull=False).first()
        demo.name = "Edited demo gift"
        demo.save()
        self.seed()
        ordinary.refresh_from_db()
        demo.refresh_from_db()
        self.assertEqual(ordinary.name, "A real gift")
        self.assertEqual(demo.name, "Edited demo gift")

    def test_no_profiles_is_a_clear_error_and_missing_events_are_supported(self):
        with self.assertRaisesRegex(CommandError, "active configured profiles"):
            self.seed()
        make_profile("alex", "Alex")
        self.seed()
        self.assertTrue(WishlistItem.objects.filter(demo_key__isnull=False, event__isnull=True).exists())

    def test_seed_rolls_back_all_items_when_a_seed_write_fails(self):
        make_profile("alex", "Alex")
        make_profile("sam", "Sam")
        with patch("wishlist.management.commands.seed_demo.Purchase.objects.get_or_create", side_effect=RuntimeError("write failed")):
            with self.assertRaisesRegex(RuntimeError, "write failed"):
                self.seed()
        self.assertFalse(WishlistItem.objects.filter(demo_key__isnull=False).exists())

    def test_reset_requires_yes_and_only_removes_marked_items_and_marks(self):
        owner = make_profile("alex", "Alex")
        buyer = make_profile("sam", "Sam")
        ordinary = make_item(owner, name="Real gift")
        self.seed()
        demo = WishlistItem.objects.filter(demo_key__isnull=False).first()
        Purchase.objects.get_or_create(item=demo, buyer=buyer)
        with self.assertRaisesRegex(CommandError, "--yes"):
            call_command("reset_demo")
        self.assertTrue(WishlistItem.objects.filter(pk=demo.pk).exists())
        call_command("reset_demo", yes=True)
        call_command("reset_demo", yes=True)
        self.assertTrue(WishlistItem.objects.filter(pk=ordinary.pk).exists())
        self.assertFalse(WishlistItem.objects.filter(demo_key__isnull=False).exists())
        self.assertFalse(Purchase.objects.filter(item=demo).exists())

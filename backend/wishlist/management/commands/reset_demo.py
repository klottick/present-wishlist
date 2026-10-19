from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from wishlist.models import WishlistItem


class Command(BaseCommand):
    help = "Delete only explicitly marked demo wishlist items and their purchase marks."

    def add_arguments(self, parser):
        parser.add_argument("--yes", action="store_true", help="Confirm deletion of marked demo records.")

    @transaction.atomic
    def handle(self, *args, **options):
        if not options["yes"]:
            raise CommandError("Refusing to delete demo records without --yes.")
        demo_items = WishlistItem.objects.filter(demo_key__isnull=False)
        count = demo_items.count()
        demo_items.delete()
        self.stdout.write(self.style.SUCCESS(f"Deleted {count} demo item(s) and dependent purchase marks."))

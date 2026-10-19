from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from wishlist.configuration.loader import ConfigError, load_family_config
from wishlist.models import Event, FamilyProfile, Purchase, WishlistItem


DEMO_ITEMS = (
    ("book", "The Little Book of Big Ideas", "https://books.example.com/ideas", "A cozy read for a rainy afternoon.", False, "birthday"),
    ("tea", "Ceramic Tea Set", "https://home.example.com/tea-set", "For slow weekend mornings.", False, "anything"),
    ("puzzle", "Woodland Jigsaw Puzzle", "https://games.example.com/woodland-puzzle", "A 500-piece forest scene.", True, "birthday"),
    ("plant", "Tiny Desk Plant", "https://garden.example.com/desk-plant", "Easy-care greenery.", False, "anything"),
)


class Command(BaseCommand):
    help = "Create repeatable, clearly marked fictional wishlist demo records."

    @transaction.atomic
    def handle(self, *args, **options):
        try:
            config = load_family_config(settings.FAMILY_CONFIG_PATH)
        except ConfigError as error:
            raise CommandError(str(error)) from error
        profiles = list(FamilyProfile.objects.filter(is_active=True, config_key__in=config.members).order_by("config_key"))
        if not profiles:
            raise CommandError("No active configured profiles are available; configure family members first.")
        events = {event.config_key: event for event in Event.objects.filter(is_active=True, config_key__in=config.events)}
        buyers = [profile for profile in profiles if len(profiles) >= 2]
        for index, (key, name, link, notes, repeat, event_key) in enumerate(DEMO_ITEMS):
            owner = profiles[index % len(profiles)]
            event = events.get(event_key) if event_key != "anything" else None
            item, created = WishlistItem.objects.get_or_create(
                demo_key=key,
                defaults={
                    "owner": owner, "name": name, "link": link, "notes": notes,
                    "allow_multiple_purchases": repeat, "event": event,
                },
            )
            if created and buyers:
                buyer = buyers[index % len(buyers)]
                if buyer.pk == owner.pk:
                    buyer = buyers[(buyers.index(buyer) + 1) % len(buyers)]
                Purchase.objects.get_or_create(item=item, buyer=buyer)
        self.stdout.write(self.style.SUCCESS("Demo wishlist records are ready."))

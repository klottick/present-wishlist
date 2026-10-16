from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from wishlist.configuration.loader import ConfigError, load_family_config
from wishlist.configuration.sync import sync_family_config


class Command(BaseCommand):
    help = "Synchronize family profiles and events from authoritative YAML."

    def add_arguments(self, parser):
        parser.add_argument(
            "--config",
            default=settings.FAMILY_CONFIG_PATH,
            help="Path to family configuration YAML (defaults to FAMILY_CONFIG_PATH).",
        )

    def handle(self, *args, **options):
        config_path = Path(options["config"])
        try:
            config = load_family_config(config_path)
        except ConfigError as error:
            raise CommandError(str(error)) from error
        sync_family_config(config)
        self.stdout.write(self.style.SUCCESS(f"Synchronized family configuration from {config_path}"))

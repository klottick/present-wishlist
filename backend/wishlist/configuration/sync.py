from django.db import transaction

from wishlist.configuration.loader import FamilyConfig
from wishlist.models import Event, FamilyProfile


@transaction.atomic
def sync_family_config(config: FamilyConfig) -> None:
    for key, name in config.members.items():
        FamilyProfile.objects.update_or_create(
            config_key=key, defaults={"name": name, "is_active": True}
        )
    for key, label in config.events.items():
        Event.objects.update_or_create(
            config_key=key, defaults={"label": label, "is_active": True}
        )

    FamilyProfile.objects.filter(is_active=True).exclude(
        config_key__in=config.members
    ).update(is_active=False)
    Event.objects.filter(is_active=True).exclude(
        config_key__in=config.events
    ).update(is_active=False)

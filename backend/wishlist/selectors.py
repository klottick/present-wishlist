from django.db.models import Prefetch, Q
from rest_framework.exceptions import NotFound, ValidationError

from wishlist.models import Event, FamilyProfile, Purchase, WishlistItem


def wishlist_items(owner_id: int, event_filter: str | None = None):
    try:
        owner = FamilyProfile.objects.get(pk=owner_id, is_active=True)
    except (FamilyProfile.DoesNotExist, ValueError, TypeError):
        raise NotFound("Wishlist not found.")

    items = WishlistItem.objects.filter(owner=owner).select_related("owner", "event")
    if event_filter is None:
        pass
    elif event_filter == "anything":
        items = items.filter(event__isnull=True)
    else:
        try:
            event = Event.objects.get(config_key=event_filter, is_active=True)
        except Event.DoesNotExist:
            raise ValidationError({"event": ["Select a valid event filter."]})
        items = items.filter(Q(event=event) | Q(event__isnull=True))

    return items.prefetch_related(
        Prefetch(
            "purchases",
            queryset=Purchase.objects.select_related("buyer").order_by("created_at", "id"),
        )
    ).order_by("-created_at", "-id")


def visible_item(item_id: int) -> WishlistItem:
    try:
        return (
            WishlistItem.objects.select_related("owner", "event")
            .prefetch_related(
                Prefetch(
                    "purchases",
                    queryset=Purchase.objects.select_related("buyer").order_by(
                        "created_at", "id"
                    ),
                )
            )
            .get(pk=item_id, owner__is_active=True)
        )
    except (WishlistItem.DoesNotExist, ValueError, TypeError):
        raise NotFound("Wishlist item not found.")

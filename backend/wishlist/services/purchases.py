from django.http import Http404
from rest_framework.exceptions import PermissionDenied

from wishlist.errors import DomainError
from wishlist.models import FamilyProfile, Purchase, WishlistItem
from wishlist.selectors import visible_item
from wishlist.services.transactions import atomic_mutation


def _item_for_purchase(item_id: int) -> WishlistItem:
    try:
        return WishlistItem.objects.select_related("event").get(
            pk=item_id, owner__is_active=True
        )
    except (WishlistItem.DoesNotExist, ValueError, TypeError):
        raise Http404("Wishlist item not found.")


def _check_buyer_is_not_owner(item: WishlistItem, buyer: FamilyProfile) -> None:
    if item.owner_id == buyer.pk:
        raise PermissionDenied("You cannot purchase your own wishlist item.")


def _check_buyer_is_active(buyer: FamilyProfile) -> None:
    if not FamilyProfile.objects.filter(pk=buyer.pk, is_active=True).exists():
        raise DomainError("identity_required", "Choose your name to continue.", 403)


def mark_purchased(item_id: int, buyer: FamilyProfile) -> WishlistItem:
    with atomic_mutation():
        _check_buyer_is_active(buyer)
        item = _item_for_purchase(item_id)
        _check_buyer_is_not_owner(item, buyer)

        if Purchase.objects.filter(item=item, buyer=buyer).exists():
            return visible_item(item.pk)

        has_purchases = Purchase.objects.filter(item=item).exists()
        if has_purchases and not item.allow_multiple_purchases:
            raise DomainError(
                "already_purchased",
                "This item has already been purchased.",
                409,
            )

        Purchase.objects.create(item=item, buyer=buyer)
        return visible_item(item.pk)


def undo_purchase(item_id: int, buyer: FamilyProfile) -> WishlistItem:
    with atomic_mutation():
        _check_buyer_is_active(buyer)
        item = _item_for_purchase(item_id)
        _check_buyer_is_not_owner(item, buyer)
        Purchase.objects.filter(item=item, buyer=buyer).delete()
        return visible_item(item.pk)

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import URLValidator
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied, ValidationError

from wishlist.models import Event, FamilyProfile, WishlistItem, WishlistItemLink
from wishlist.services.transactions import atomic_mutation


_FIELD_LIMITS = {"name": 200, "link": 2000, "price": 80, "notes": 5000}
_INPUT_FIELDS = {*_FIELD_LIMITS, "links", "event_id", "allow_multiple_purchases"}
_url_validator = URLValidator(schemes=("http", "https"))


def validate_item_input(data: dict, *, instance: WishlistItem | None = None, partial: bool = False) -> dict:
    if not isinstance(data, dict):
        raise ValidationError({"non_field_errors": ["Expected a JSON object."]})

    errors = {}
    for field in data:
        if field not in _INPUT_FIELDS:
            errors[field] = ["Unknown or read-only field."]
    if not partial and "name" not in data:
        errors["name"] = ["This field is required."]

    validated = {}
    if "link" in data and "links" in data:
        errors["links"] = ["Use links or link, not both."]
    if "links" in data:
        urls = data["links"]
        cleaned = []
        if not isinstance(urls, list):
            errors["links"] = ["Must be a list of URLs."]
        else:
            for index, value in enumerate(urls):
                field = f"links.{index}"
                if not isinstance(value, str):
                    errors[field] = ["Must be a URL string."]
                    continue
                value = value.strip()
                if not value:
                    continue
                if len(value) > 2000:
                    errors[field] = ["Must be 2000 characters or fewer."]
                else:
                    try:
                        _url_validator(value)
                    except DjangoValidationError:
                        errors[field] = ["Enter a valid HTTP or HTTPS URL."]
                if value in cleaned:
                    errors[field] = ["This link is already included."]
                cleaned.append(value)
            if len(cleaned) > 10:
                errors["links"] = ["Add up to 10 links per gift."]
            validated["links"] = cleaned
            validated["link"] = cleaned[0] if cleaned else ""
    for field, limit in _FIELD_LIMITS.items():
        if field not in data:
            if not partial and field != "name":
                validated.setdefault(field, "")
            continue
        value = data[field]
        if not isinstance(value, str):
            errors[field] = ["Must be a string."]
            continue
        value = value.strip() if field == "name" else value
        if len(value) > limit:
            errors[field] = [f"Must be {limit} characters or fewer."]
        elif field == "name" and not value:
            errors[field] = ["This field may not be blank."]
        elif field == "link" and value:
            try:
                _url_validator(value)
            except DjangoValidationError:
                errors[field] = ["Enter a valid HTTP or HTTPS URL."]
        validated[field] = value
        if field == "link" and "links" not in data:
            validated["links"] = [value] if value else []

    if "allow_multiple_purchases" in data:
        value = data["allow_multiple_purchases"]
        if type(value) is not bool:
            errors["allow_multiple_purchases"] = ["Must be a boolean."]
        else:
            validated["allow_multiple_purchases"] = value
    elif not partial:
        validated["allow_multiple_purchases"] = False

    if "event_id" in data:
        event_id = data["event_id"]
        if event_id is None:
            validated["event"] = None
        elif type(event_id) is not int:
            errors["event_id"] = ["Must be an integer or null."]
        else:
            event = Event.objects.filter(pk=event_id).first()
            if event is None:
                errors["event_id"] = ["Select a valid event."]
            elif event.is_active:
                validated["event"] = event
            elif instance is not None and instance.event_id == event.pk:
                validated["event"] = event
            else:
                errors["event_id"] = ["Select an active event."]
    elif not partial:
        validated["event"] = None

    if errors:
        raise ValidationError(errors)
    return validated


def create_item(owner: FamilyProfile, data: dict) -> WishlistItem:
    with atomic_mutation():
        validated = validate_item_input(data)
        links = validated.pop("links", [])
        item = WishlistItem.objects.create(owner=owner, **validated)
        _replace_links(item, links)
        return item


def update_item(item_id: int, actor: FamilyProfile, data: dict) -> WishlistItem:
    with atomic_mutation():
        item = get_object_or_404(WishlistItem.objects.select_related("event"), pk=item_id)
        if item.owner_id != actor.pk:
            raise PermissionDenied("You may only edit your own wishlist items.")
        validated = validate_item_input(data, instance=item, partial=True)
        links = validated.pop("links", None)
        for field, value in validated.items():
            setattr(item, field, value)
        if validated:
            item.save(update_fields=(*validated.keys(), "updated_at"))
        if links is not None:
            _replace_links(item, links)
        return item


def _replace_links(item: WishlistItem, urls: list[str]) -> None:
    existing = {link.url: link for link in item.links.all()}
    item.links.exclude(url__in=urls).delete()
    for position, url in enumerate(urls):
        if url in existing:
            link = existing[url]
            if link.position != position:
                link.position = position
                link.save(update_fields=("position",))
        else:
            WishlistItemLink.objects.create(item=item, url=url, position=position)


def delete_item(item_id: int, actor: FamilyProfile) -> None:
    with atomic_mutation():
        item = get_object_or_404(WishlistItem, pk=item_id)
        if item.owner_id != actor.pk:
            raise PermissionDenied("You may only delete your own wishlist items.")
        item.delete()

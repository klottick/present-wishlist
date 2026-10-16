def serialize_profile(profile):
    return {"id": profile.pk, "key": profile.config_key, "name": profile.name}


def serialize_event(event):
    return {
        "id": event.pk,
        "key": event.config_key,
        "label": event.label,
        "is_active": event.is_active,
    }


def serialize_item(item, viewer):
    data = {
        "id": item.pk,
        "owner_id": item.owner_id,
        "name": item.name,
        "link": item.link,
        "price": item.price,
        "notes": item.notes,
        "event": serialize_event(item.event) if item.event_id else None,
        "allow_multiple_purchases": item.allow_multiple_purchases,
        "created_at": item.created_at.isoformat(),
        "updated_at": item.updated_at.isoformat(),
        "is_owner": viewer.pk == item.owner_id,
    }
    if data["is_owner"]:
        return data

    purchases = list(item.purchases.all())
    own_purchase = any(purchase.buyer_id == viewer.pk for purchase in purchases)
    data.update(
        {
            "purchases": [
                {"buyer_id": purchase.buyer_id, "buyer_name": purchase.buyer.name}
                for purchase in purchases
            ],
            "can_purchase": not own_purchase
            and (item.allow_multiple_purchases or not purchases),
            "can_undo": own_purchase,
        }
    )
    return data

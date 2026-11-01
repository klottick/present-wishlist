from django.conf import settings
from django.db import models


class FamilyProfile(models.Model):
    config_key = models.CharField(max_length=80, unique=True)
    name = models.CharField(max_length=80)
    is_active = models.BooleanField(default=True)
    avatar_data = models.BinaryField(default=bytes, blank=True)
    avatar_version = models.CharField(max_length=32, blank=True, default="")
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class Event(models.Model):
    config_key = models.CharField(max_length=80, unique=True)
    label = models.CharField(max_length=80)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.label


class WishlistItem(models.Model):
    demo_key = models.CharField(max_length=80, unique=True, null=True, blank=True, editable=False)
    owner = models.ForeignKey(
        FamilyProfile, on_delete=models.PROTECT, related_name="items"
    )
    name = models.CharField(max_length=200)
    link = models.CharField(max_length=2000, blank=True, default="")
    price = models.CharField(max_length=80, blank=True, default="")
    notes = models.TextField(max_length=5000, blank=True, default="")
    event = models.ForeignKey(
        Event,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="items",
    )
    allow_multiple_purchases = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name


class WishlistItemLink(models.Model):
    item = models.ForeignKey(WishlistItem, on_delete=models.CASCADE, related_name="links")
    url = models.CharField(max_length=2000)
    position = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ("position", "id")
        constraints = [models.UniqueConstraint(fields=("item", "url"), name="unique_url_per_item")]


class Purchase(models.Model):
    item = models.ForeignKey(
        WishlistItem, on_delete=models.CASCADE, related_name="purchases"
    )
    buyer = models.ForeignKey(
        FamilyProfile, on_delete=models.PROTECT, related_name="purchases"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("item", "buyer"), name="unique_buyer_per_item"
            )
        ]

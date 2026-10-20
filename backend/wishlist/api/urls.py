from django.urls import path

from wishlist.api.catalog import EventsView, ProfilesView
from wishlist.api.config import ConfigView
from wishlist.api.items import ItemCreateView, ItemDetailView, ItemListView
from wishlist.api.purchases import PurchaseView
from wishlist.api.session import SessionView


urlpatterns = [
    path("config/", ConfigView.as_view(), name="api-config"),
    path("session/", SessionView.as_view(), name="api-session"),
    path("profiles/", ProfilesView.as_view(), name="api-profiles"),
    path("events/", EventsView.as_view(), name="api-events"),
    path("items/", ItemCreateView.as_view(), name="api-item-create"),
    path("profiles/<int:owner_id>/items/", ItemListView.as_view(), name="api-profile-items"),
    path("items/<int:item_id>/", ItemDetailView.as_view(), name="api-item-detail"),
    path("items/<int:item_id>/purchase/", PurchaseView.as_view(), name="api-item-purchase"),
]

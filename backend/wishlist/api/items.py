from rest_framework import status
from rest_framework.response import Response

from wishlist.api.base import FamilyAPIView
from wishlist.selectors import visible_item, wishlist_items
from wishlist.serialization import serialize_item
from wishlist.services.items import (
    create_item,
    delete_item,
    update_item,
)


class ItemListView(FamilyAPIView):
    def get(self, request, owner_id):
        viewer = self.require_profile(request)
        event_filter = request.query_params.get("event")
        items = wishlist_items(owner_id, event_filter)
        return Response([serialize_item(item, viewer) for item in items])



class ItemCreateView(FamilyAPIView):
    def post(self, request):
        owner = self.require_profile(request)
        item = create_item(owner, request.data)
        return Response(serialize_item(item, owner), status=status.HTTP_201_CREATED)


class ItemDetailView(FamilyAPIView):
    def get(self, request, item_id):
        viewer = self.require_profile(request)
        return Response(serialize_item(visible_item(item_id), viewer))

    def patch(self, request, item_id):
        actor = self.require_profile(request)
        item = update_item(item_id, actor, request.data)
        return Response(serialize_item(item, actor))

    def delete(self, request, item_id):
        actor = self.require_profile(request)
        delete_item(item_id, actor)
        return Response(status=status.HTTP_204_NO_CONTENT)

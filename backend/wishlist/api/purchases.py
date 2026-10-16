from rest_framework import status
from rest_framework.response import Response

from wishlist.api.base import FamilyAPIView
from wishlist.serialization import serialize_item
from wishlist.services.purchases import mark_purchased, undo_purchase


class PurchaseView(FamilyAPIView):
    def put(self, request, item_id):
        buyer = self.require_profile(request)
        item = mark_purchased(item_id, buyer)
        return Response(serialize_item(item, buyer), status=status.HTTP_200_OK)

    def delete(self, request, item_id):
        buyer = self.require_profile(request)
        item = undo_purchase(item_id, buyer)
        return Response(serialize_item(item, buyer), status=status.HTTP_200_OK)

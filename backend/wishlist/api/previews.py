from django.shortcuts import get_object_or_404
from rest_framework.response import Response

from wishlist.api.base import FamilyAPIView
from wishlist.models import WishlistItemLink
from wishlist.services.previews import preview_for_link


class LinkPreviewView(FamilyAPIView):
    def post(self, request, link_id):
        self.require_profile(request)
        link = get_object_or_404(WishlistItemLink, pk=link_id, item__owner__is_active=True)
        return Response(preview_for_link(link))

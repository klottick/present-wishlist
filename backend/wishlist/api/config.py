from django.conf import settings
from rest_framework.response import Response

from wishlist.api.base import FamilyAPIView
from wishlist.configuration.loader import load_family_config


class ConfigView(FamilyAPIView):
    authentication_classes = []
    permission_classes = []

    def get(self, request):
        config = load_family_config(settings.FAMILY_CONFIG_PATH)
        return Response({"family_name": config.family_name})

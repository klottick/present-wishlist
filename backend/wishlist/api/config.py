from django.conf import settings
from rest_framework.response import Response

from wishlist.api.base import FamilyAPIView
from wishlist.configuration.loader import ConfigError, load_family_config
from wishlist.errors import DomainError


class ConfigView(FamilyAPIView):
    authentication_classes = []
    permission_classes = []

    def get(self, request):
        try:
            config = load_family_config(settings.FAMILY_CONFIG_PATH)
        except ConfigError as error:
            raise DomainError(
                "configuration_error", "Family configuration is unavailable.", 503
            ) from error
        return Response({"family_name": config.family_name})

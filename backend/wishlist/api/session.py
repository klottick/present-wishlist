from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework.response import Response

from wishlist.api.base import FamilyAPIView
from wishlist.errors import DomainError
from wishlist.identity import SESSION_PROFILE_KEY, current_profile
from wishlist.models import FamilyProfile
from wishlist.serialization import serialize_profile


@method_decorator(ensure_csrf_cookie, name="dispatch")
class SessionView(FamilyAPIView):
    def get(self, request):
        return Response({"profile": _profile_data(current_profile(request))})

    def put(self, request):
        data = request.data
        profile_id = data.get("profile_id") if isinstance(data, dict) else None
        if isinstance(profile_id, bool) or not isinstance(profile_id, int):
            raise DomainError("validation_error", "A valid profile_id is required.", 400)
        profile = FamilyProfile.objects.filter(pk=profile_id, is_active=True).first()
        if profile is None:
            raise DomainError("validation_error", "A valid profile_id is required.", 400)
        request.session[SESSION_PROFILE_KEY] = profile.pk
        return Response({"profile": serialize_profile(profile)})

    def delete(self, request):
        request.session.pop(SESSION_PROFILE_KEY, None)
        return Response({"profile": None})


def _profile_data(profile):
    return serialize_profile(profile) if profile else None

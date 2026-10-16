from rest_framework.response import Response

from wishlist.api.base import FamilyAPIView
from wishlist.models import Event, FamilyProfile
from wishlist.serialization import serialize_event, serialize_profile


class ProfilesView(FamilyAPIView):
    def get(self, request):
        profiles = sorted(
            FamilyProfile.objects.filter(is_active=True),
            key=lambda profile: (profile.name.casefold(), profile.pk),
        )
        return Response([serialize_profile(profile) for profile in profiles])


class EventsView(FamilyAPIView):
    def get(self, request):
        events = sorted(
            Event.objects.filter(is_active=True),
            key=lambda event: (event.label.casefold(), event.pk),
        )
        return Response([serialize_event(event) for event in events])

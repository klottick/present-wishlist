from django.http import HttpResponse, HttpResponseNotModified
from django.shortcuts import get_object_or_404
from django.utils.http import parse_etags
from django.views.decorators.http import require_safe
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response

from wishlist.api.base import FamilyAPIView
from wishlist.models import FamilyProfile
from wishlist.serialization import serialize_profile
from wishlist.services.avatars import MAX_UPLOAD_BYTES, normalize_avatar, save_avatar


class AvatarView(FamilyAPIView):
    parser_classes = [MultiPartParser]

    def put(self, request):
        profile = self.require_profile(request)
        if int(request.META.get('CONTENT_LENGTH') or 0) > MAX_UPLOAD_BYTES + 65536:
            raise ValidationError({'photo': ['Choose a photo no larger than 5 MB.']})
        data = normalize_avatar(request.data.get('photo'))
        return Response(serialize_profile(save_avatar(profile, data)))

    def delete(self, request):
        profile = self.require_profile(request)
        return Response(serialize_profile(save_avatar(profile, b'')))


@require_safe
def avatar_image(request, profile_id):
    profile = get_object_or_404(FamilyProfile, pk=profile_id, is_active=True)
    if not profile.avatar_version:
        from django.http import Http404
        raise Http404
    etag = f'"{profile.avatar_version}"'
    matches = parse_etags(request.headers.get('If-None-Match', ''))
    if etag in matches or '*' in matches:
        response = HttpResponseNotModified()
    else:
        response = HttpResponse(bytes(profile.avatar_data), content_type='image/jpeg')
    response['ETag'] = etag
    response['Cache-Control'] = 'public, max-age=300'
    response['X-Content-Type-Options'] = 'nosniff'
    return response

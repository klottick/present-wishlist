from wishlist.models import FamilyProfile


SESSION_PROFILE_KEY = "family_profile_id"


def current_profile(request):
    profile_id = request.session.get(SESSION_PROFILE_KEY)
    if profile_id is None:
        return None
    try:
        return FamilyProfile.objects.get(pk=profile_id, is_active=True)
    except (FamilyProfile.DoesNotExist, ValueError, TypeError):
        request.session.pop(SESSION_PROFILE_KEY, None)
        return None


def require_profile(request):
    from wishlist.errors import DomainError

    profile = current_profile(request)
    if profile is None:
        raise DomainError("identity_required", "Choose your name to continue.", 403)
    return profile

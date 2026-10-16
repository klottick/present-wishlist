from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect
from rest_framework.response import Response
from rest_framework.views import APIView

from wishlist.errors import DomainError
from wishlist.identity import require_profile


@method_decorator(csrf_protect, name="dispatch")
class FamilyAPIView(APIView):
    def require_profile(self, request):
        return require_profile(request)


def api_exception_handler(exc, context):
    from rest_framework.views import exception_handler

    if isinstance(exc, DomainError):
        data = {"code": exc.code, "message": exc.message}
        if exc.fields is not None:
            data["fields"] = exc.fields
        return Response(data, status=exc.status)

    response = exception_handler(exc, context)
    if response is None:
        return None
    errors = {
        400: ("validation_error", "Invalid request."),
        403: ("forbidden", "You do not have permission to perform this action."),
        404: ("not_found", "Not found."),
        405: ("method_not_allowed", "Method not allowed."),
    }
    code, message = errors.get(
        response.status_code, ("request_error", "The request could not be completed.")
    )
    data = {"code": code, "message": message}
    if code == "validation_error":
        details = response.data
        if isinstance(details, dict) and "detail" not in details:
            data["fields"] = details
        elif isinstance(details, list):
            data["fields"] = {"non_field_errors": details}
    response.data = data
    return response

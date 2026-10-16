from django.http import JsonResponse


class ApiResponseMiddleware:
    """Keep every API response private and normalize errors made before DRF."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if request.path.startswith("/api/"):
            response["Cache-Control"] = "no-store"
            if response.status_code >= 400 and not response.get("Content-Type", "").startswith(
                "application/json"
            ):
                response = _json_error(response.status_code)
                response["Cache-Control"] = "no-store"
        return response


def csrf_failure(request, reason=""):
    response = JsonResponse(
        {"code": "csrf_failed", "message": "CSRF verification failed."}, status=403
    )
    response["Cache-Control"] = "no-store"
    return response


def _json_error(status):
    if status == 404:
        code, message = "not_found", "Not found."
    elif status == 405:
        code, message = "method_not_allowed", "Method not allowed."
    elif status == 403:
        code, message = "forbidden", "You do not have permission to perform this action."
    elif status == 400:
        code, message = "validation_error", "Invalid request."
    else:
        code, message = "server_error", "The request could not be completed."
    return JsonResponse({"code": code, "message": message}, status=status)

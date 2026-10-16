from django.contrib.sessions.models import Session
from django.db import DatabaseError, connection
from django.http import HttpRequest, JsonResponse
from django.views.decorators.http import require_safe

from wishlist.models import FamilyProfile


@require_safe
def health(request: HttpRequest) -> JsonResponse:
    try:
        with connection.cursor() as cursor:
            for model in (FamilyProfile, Session):
                table = connection.ops.quote_name(model._meta.db_table)
                cursor.execute(f"SELECT 1 FROM {table} LIMIT 1")
        response = JsonResponse({"status": "ok"})
    except DatabaseError:
        response = JsonResponse({"status": "unavailable"}, status=503)
    response["Cache-Control"] = "no-store"
    return response

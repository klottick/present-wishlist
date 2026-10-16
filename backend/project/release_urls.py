from django.urls import path

from .health import health
from .urls import urlpatterns as api_urls


urlpatterns = [path("healthz/", health, name="health"), *api_urls]

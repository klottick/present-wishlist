from pathlib import Path
import os
from urllib.parse import urlsplit


BASE_DIR = Path(__file__).resolve().parent.parent
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "local-development-only")
DEBUG = True
ALLOWED_HOSTS = ["localhost", "127.0.0.1", "testserver"]
DEFAULT_CSRF_TRUSTED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
]


def build_csrf_trusted_origins(extra_origin: str | None = None) -> list[str]:
    origins = list(DEFAULT_CSRF_TRUSTED_ORIGINS)
    if not extra_origin:
        return origins
    try:
        parsed = urlsplit(extra_origin)
        port = parsed.port
    except ValueError as error:
        raise ValueError("WISHLIST_EXTRA_CSRF_TRUSTED_ORIGIN must be an exact loopback HTTP origin") from error
    if (
        extra_origin != extra_origin.strip()
        or parsed.scheme != "http"
        or parsed.hostname not in {"127.0.0.1", "localhost"}
        or port is None
        or not 1 <= port <= 65535
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("WISHLIST_EXTRA_CSRF_TRUSTED_ORIGIN must be an exact loopback HTTP origin")
    if extra_origin not in origins:
        origins.append(extra_origin)
    return origins


CSRF_TRUSTED_ORIGINS = build_csrf_trusted_origins(
    os.environ.get("WISHLIST_EXTRA_CSRF_TRUSTED_ORIGIN")
)
ROOT_URLCONF = "project.urls"
WSGI_APPLICATION = "project.wsgi.application"
ASGI_APPLICATION = "project.asgi.application"

INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "rest_framework",
    "wishlist.apps.WishlistConfig",
]

MIDDLEWARE = [
    "wishlist.api.middleware.ApiResponseMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
]

CSRF_FAILURE_VIEW = "wishlist.api.middleware.csrf_failure"
REST_FRAMEWORK = {
    "EXCEPTION_HANDLER": "wishlist.api.base.api_exception_handler",
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
}

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": os.environ.get("WISHLIST_DB_PATH", str(BASE_DIR / "db.sqlite3")),
        "OPTIONS": {"transaction_mode": "IMMEDIATE", "timeout": 20},
    }
}

DEFAULT_AUTO_FIELD = "django.db.models.AutoField"
USE_TZ = True
TIME_ZONE = "UTC"
LANGUAGE_CODE = "en-us"
STATIC_URL = "static/"
FAMILY_CONFIG_PATH = Path(
    os.environ.get("FAMILY_CONFIG_PATH", str(BASE_DIR / "config" / "family.yaml"))
)

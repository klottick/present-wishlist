"""Settings for the single-origin, trust-based container distribution."""

import ipaddress
import re
from urllib.parse import urlsplit

from django.core.exceptions import ImproperlyConfigured

from .settings import *  # noqa: F403


def _host(value: str) -> bool:
    if value.startswith("[") and value.endswith("]"):
        try:
            return ipaddress.ip_address(value[1:-1]).version == 6
        except ValueError:
            return False
    try:
        return ipaddress.ip_address(value).version == 4
    except ValueError:
        if re.fullmatch(r"[0-9.]+", value):
            return False
    return len(value) <= 253 and all(
        re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label, re.IGNORECASE)
        for label in value.split(".")
    )


def _hosts(raw: str) -> list[str]:
    values = ["localhost", "127.0.0.1", "[::1]"]
    if raw:
        for entry in raw.split(","):
            entry = entry.strip().lower()
            if not _host(entry):
                raise ImproperlyConfigured("DJANGO_ALLOWED_HOSTS must contain exact hostnames or IP addresses, without ports.")
            if entry not in values:
                values.append(entry)
    return values


def _origins(raw: str) -> list[str]:
    values = []
    if not raw:
        return values
    for entry in raw.split(","):
        entry = entry.strip()
        try:
            parsed = urlsplit(entry)
            port = parsed.port
            hostname = parsed.hostname or ""
            host = f"[{hostname}]" if ":" in hostname else hostname
            valid = (
                parsed.scheme in {"http", "https"}
                and _host(host)
                and not parsed.username and not parsed.password
                and not parsed.netloc.endswith(":")
                and (port is None or 1 <= port <= 65535)
                and entry == f"{parsed.scheme}://{parsed.netloc}"
            )
        except ValueError:
            valid = False
        if not valid:
            raise ImproperlyConfigured("DJANGO_CSRF_TRUSTED_ORIGINS must contain exact HTTP/HTTPS origins without paths or credentials.")
        if entry not in values:
            values.append(entry)
    return values


SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "")  # noqa: F405
if (
    len(SECRET_KEY) < 50 or len(set(SECRET_KEY)) < 5 or SECRET_KEY != SECRET_KEY.strip()
    or any(marker in SECRET_KEY.lower() for marker in ("change_me", "change-me", "development-only", "django-insecure-"))
):
    raise ImproperlyConfigured("DJANGO_SECRET_KEY must be a private random value of at least 50 characters; generate one with openssl rand -hex 32.")

DEBUG = False
ALLOWED_HOSTS = _hosts(os.environ.get("DJANGO_ALLOWED_HOSTS", ""))  # noqa: F405
CSRF_TRUSTED_ORIGINS = _origins(os.environ.get("DJANGO_CSRF_TRUSTED_ORIGINS", ""))  # noqa: F405
USE_X_FORWARDED_HOST = False
SECURE_PROXY_SSL_HEADER = None
ROOT_URLCONF = "project.release_urls"
WSGI_APPLICATION = "project.release_wsgi.application"
FAMILY_CONFIG_PATH = Path(os.environ.get("FAMILY_CONFIG_PATH", "/config/family.yaml"))  # noqa: F405
DATABASES["default"]["NAME"] = os.environ.get("WISHLIST_DB_PATH", "/data/wishlist.sqlite3")  # noqa: F405
FRONTEND_DIST_PATH = Path(os.environ.get("FRONTEND_DIST_PATH", BASE_DIR.parent / "frontend/dist"))  # noqa: F405

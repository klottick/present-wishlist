#!/usr/bin/env python3
"""Validate, migrate, sync, then replace this process with the release server."""

import os
from pathlib import Path
import sys
import tempfile


ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    os.umask(0o077)
    sys.path.insert(0, str(ROOT / "backend"))
    os.environ["DJANGO_SETTINGS_MODULE"] = "project.release_settings"

    import django
    from django.conf import settings
    from django.core.exceptions import ImproperlyConfigured
    from django.core.management import call_command, CommandError
    from django.db import DatabaseError

    from wishlist.configuration.loader import ConfigError, load_family_config

    try:
        django.setup()
        load_family_config(settings.FAMILY_CONFIG_PATH)
        with (settings.FRONTEND_DIST_PATH / "index.html").open("rb"):
            pass
        database = Path(settings.DATABASES["default"]["NAME"])
        if not database.parent.is_dir():
            raise ValueError("Database parent directory must exist and be writable by the application user.")
        with tempfile.TemporaryFile(dir=database.parent):
            pass
        if database.exists():
            if not database.is_file():
                raise ValueError("Database path must be a writable regular file.")
            with database.open("r+b"):
                pass
        os.chdir(ROOT / "backend")
        call_command("migrate", interactive=False)
        call_command("sync_family_config", config=str(settings.FAMILY_CONFIG_PATH))
        os.execvp("gunicorn", [
            "gunicorn", "project.release_wsgi:application",
            "--bind", "0.0.0.0:8000", "--workers", "1", "--worker-class", "gthread",
            "--threads", "4", "--timeout", "60", "--graceful-timeout", "20",
            "--access-logfile", "-", "--error-logfile", "-", "--forwarded-allow-ips", "",
            "--no-control-socket", "--umask", "0077",
        ])
        return 0  # Reached only when exec is replaced by a test double.
    except (ImproperlyConfigured, ConfigError, CommandError, DatabaseError, OSError, ValueError) as error:
        print(f"Container startup failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

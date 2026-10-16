from .settings import *  # noqa: F403

DATABASES["default"]["NAME"] = str(BASE_DIR / ".test.sqlite3")  # noqa: F405
DATABASES["default"]["TEST"] = {"NAME": str(BASE_DIR / ".test.sqlite3")}

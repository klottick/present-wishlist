import sqlite3
from contextlib import contextmanager

from django.db import OperationalError, transaction

from wishlist.errors import DomainError


def is_sqlite_lock_error(exc: OperationalError) -> bool:
    cause = exc.__cause__
    if not isinstance(cause, sqlite3.OperationalError):
        return False
    code = getattr(cause, "sqlite_errorcode", None)
    if code is not None:
        return (code & 0xFF) in (sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED)
    message = str(cause).lower()
    return message in ("database is locked", "database table is locked", "database is busy")


@contextmanager
def atomic_mutation():
    try:
        with transaction.atomic():
            yield
    except OperationalError as exc:
        if is_sqlite_lock_error(exc):
            raise DomainError(
                "database_busy",
                "The database is busy. Please retry the request.",
                503,
            ) from exc
        raise

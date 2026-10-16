import json
import threading
from contextlib import contextmanager

from django.db import close_old_connections, connections, transaction
from django.test import Client, TestCase

from wishlist.models import Event, FamilyProfile, WishlistItem


def make_profile(key: str, name: str | None = None) -> FamilyProfile:
    return FamilyProfile.objects.create(config_key=key, name=name or key.title())


def make_event(
    key: str, label: str | None = None, *, active: bool = True
) -> Event:
    return Event.objects.create(
        config_key=key,
        label=label or key.title(),
        is_active=active,
    )


def make_item(owner: FamilyProfile, **fields) -> WishlistItem:
    return WishlistItem.objects.create(owner=owner, **fields)


def select_profile(client, profile):
    """Select a profile through the API, including its real CSRF bootstrap."""
    bootstrap = client.get("/api/session/")
    csrf_token = bootstrap.cookies["csrftoken"].value
    return client.put(
        "/api/session/",
        data=json.dumps({"profile_id": profile.pk}),
        content_type="application/json",
        HTTP_X_CSRFTOKEN=csrf_token,
    )


@contextmanager
def hold_sqlite_write_lock(item_id: int):
    """Hold a real SQLite write lock while the caller exercises an API path."""
    locked = threading.Event()
    release = threading.Event()
    lock_errors = []
    connection = connections["default"]
    original_timeout = connection.settings_dict["OPTIONS"].get("timeout", 5)
    connection.settings_dict["OPTIONS"]["timeout"] = 0.05
    connection.close()

    def hold_lock():
        close_old_connections()
        worker_connection = connections["default"]
        worker_connection.settings_dict["OPTIONS"]["timeout"] = 0.05
        worker_connection.close()
        try:
            with transaction.atomic():
                WishlistItem.objects.filter(pk=item_id).update(notes="lock-holder")
                locked.set()
                if not release.wait(timeout=5):
                    raise TimeoutError("test did not release SQLite write lock")
        except Exception as exc:
            lock_errors.append(exc)
        finally:
            close_old_connections()

    thread = threading.Thread(target=hold_lock)
    thread.start()
    try:
        if not locked.wait(timeout=3):
            raise AssertionError(f"lock-holder failed to acquire SQLite write lock: {lock_errors}")
        yield lock_errors
    finally:
        release.set()
        thread.join(timeout=6)
        connection.settings_dict["OPTIONS"]["timeout"] = original_timeout
        connection.close()
        if thread.is_alive():
            raise AssertionError("lock-holder thread did not terminate")
        if lock_errors:
            raise AssertionError(f"lock-holder failed: {lock_errors}")


class WishlistTestCase(TestCase):
    def setUp(self):
        self.owner = make_profile("alex", "Alex")
        self.buyer = make_profile("sam", "Sam")
        self.other = make_profile("robin", "Robin")
        self.item = make_item(self.owner, name="A book")
        self.client = Client(enforce_csrf_checks=True)
        select_profile(self.client, self.owner)

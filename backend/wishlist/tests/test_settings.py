from pathlib import Path

from django.conf import settings
from django.db import connection
from django.test import TestCase

from project.settings import build_csrf_trusted_origins


class TestDatabaseSettingsTests(TestCase):
    def test_resolved_test_database_is_file_backed(self):
        expected_database_path = settings.BASE_DIR / ".test.sqlite3"

        self.assertEqual(Path(connection.settings_dict["NAME"]), expected_database_path)
        self.assertTrue(expected_database_path.is_file())

    def test_dynamic_csrf_origin_adds_only_the_exact_loopback_origin(self):
        origins = build_csrf_trusted_origins("http://127.0.0.1:54321")

        self.assertIn("http://127.0.0.1:54321", origins)
        self.assertNotIn("http://127.0.0.1:*", origins)
        self.assertEqual(origins.count("http://127.0.0.1:54321"), 1)

    def test_dynamic_csrf_origin_rejects_wildcard_and_non_loopback_hosts(self):
        for origin in ("http://127.0.0.1:*", "https://127.0.0.1:54321", "http://example.com:54321", "http://127.0.0.1:54321/path"):
            with self.subTest(origin=origin), self.assertRaises(ValueError):
                build_csrf_trusted_origins(origin)

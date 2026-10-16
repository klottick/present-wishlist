import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
from unittest import TestCase as PlainTestCase
from unittest.mock import patch

from django.core.wsgi import get_wsgi_application
from django.db import OperationalError
from django.test import RequestFactory, TestCase, override_settings


BACKEND = Path(__file__).resolve().parents[2]


class ReleaseSettingsTests(PlainTestCase):
    def probe(self, **values):
        env = {key: value for key, value in os.environ.items() if not key.startswith(
            ("DJANGO_", "WISHLIST_", "FAMILY_CONFIG_PATH", "FRONTEND_DIST_PATH")
        )}
        env.update(PYTHONPATH=str(BACKEND), DJANGO_SECRET_KEY=secrets.token_hex(32))
        env.update(values)
        if env.get("DJANGO_SECRET_KEY") == "<missing>":
            del env["DJANGO_SECRET_KEY"]
        return subprocess.run([sys.executable, "-c", """
import json
from project import release_settings as s
print(json.dumps({name: str(getattr(s, name)) if name in ('FAMILY_CONFIG_PATH', 'FRONTEND_DIST_PATH') else getattr(s, name)
 for name in ('DEBUG', 'ROOT_URLCONF', 'ALLOWED_HOSTS', 'CSRF_TRUSTED_ORIGINS',
 'USE_X_FORWARDED_HOST', 'SECURE_PROXY_SSL_HEADER', 'FAMILY_CONFIG_PATH', 'FRONTEND_DIST_PATH')}))
"""], env=env, capture_output=True, text=True)

    def test_release_defaults_are_not_development_settings(self):
        result = self.probe()
        self.assertEqual(result.returncode, 0, result.stderr)
        value = json.loads(result.stdout)
        self.assertIs(value["DEBUG"], False)
        self.assertEqual(value["ROOT_URLCONF"], "project.release_urls")
        self.assertEqual(value["ALLOWED_HOSTS"], ["localhost", "127.0.0.1", "[::1]"])
        self.assertEqual(value["CSRF_TRUSTED_ORIGINS"], [])
        self.assertIs(value["USE_X_FORWARDED_HOST"], False)
        self.assertIsNone(value["SECURE_PROXY_SSL_HEADER"])
        self.assertEqual(value["FAMILY_CONFIG_PATH"], "/config/family.yaml")

    def test_rejects_unsafe_secret_without_disclosure(self):
        for secret in ("<missing>", "", "local-development-only", "CHANGE_ME", "short", "x" * 64, " " + secrets.token_hex(32)):
            with self.subTest(secret_kind=len(secret)):
                result = self.probe(DJANGO_SECRET_KEY=secret)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("DJANGO_SECRET_KEY", result.stderr)
                if len(secret) > 10 and secret != "<missing>":
                    self.assertNotIn(secret, result.stderr + result.stdout)

    def test_accepts_exact_hosts_origins_and_path_overrides(self):
        result = self.probe(
            DJANGO_ALLOWED_HOSTS="wishlist.home, 192.168.1.20,wishlist.home,[fd00::1]",
            DJANGO_CSRF_TRUSTED_ORIGINS="https://wishlist.home,http://[fd00::1]:8000",
            FAMILY_CONFIG_PATH="/custom/family.yaml", WISHLIST_DB_PATH="/custom/family.sqlite3",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        value = json.loads(result.stdout)
        self.assertEqual(value["ALLOWED_HOSTS"][3:], ["wishlist.home", "192.168.1.20", "[fd00::1]"])
        self.assertEqual(value["CSRF_TRUSTED_ORIGINS"], ["https://wishlist.home", "http://[fd00::1]:8000"])
        self.assertEqual(value["FAMILY_CONFIG_PATH"], "/custom/family.yaml")

    def test_rejects_nonexact_hosts_and_origins(self):
        for host in ("*", ".example.com", "*.example.com", "http://example.com", "host:8000", "a,,b", "bad_host", "-host", "[nonsense]", "a/b", "999.999.999.999"):
            with self.subTest(host=host):
                result = self.probe(DJANGO_ALLOWED_HOSTS=host)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("DJANGO_ALLOWED_HOSTS", result.stderr)
        for origin in ("*", "https://*.example.com", "http://user:pass@host", "http://host/", "http://host?x=1", "http://host#fragment", "http://host:99999", "http://host:", "ftp://host", "http://host,,http://other", "http://bad_host", "http://ho st"):
            with self.subTest(origin=origin):
                result = self.probe(DJANGO_CSRF_TRUSTED_ORIGINS=origin)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("DJANGO_CSRF_TRUSTED_ORIGINS", result.stderr)


def wsgi_get(application, path, **headers):
    request = RequestFactory().get(path, **headers)
    result = {}

    def start_response(status, response_headers, exc_info=None):
        result.update(status=int(status.split()[0]), headers=dict(response_headers))

    response = application(request.environ, start_response)
    try:
        result["body"] = b"".join(response)
    finally:
        if hasattr(response, "close"):
            response.close()
    return result


class FrontendServingTests(PlainTestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        (self.root / "assets").mkdir()
        (self.root / "index.html").write_text("<!doctype html><h1>Wishlist</h1>")
        (self.root / "assets/main-abc12345.js").write_text("console.log('wishlist')")
        (self.root / "assets/plain.js").write_text("console.log('plain')")

    def application(self):
        from project.frontend_static import wrap_frontend

        def downstream(environ, start_response):
            start_response("404 Not Found", [("Content-Type", "application/json"), ("Cache-Control", "no-store")])
            return [b'{"code":"not_found"}']

        return wrap_frontend(downstream, self.root)

    def test_root_revalidates_but_hashed_assets_are_immutable(self):
        app = self.application()
        root = wsgi_get(app, "/")
        self.assertEqual(root["status"], 200)
        self.assertIn(b"Wishlist", root["body"])
        self.assertEqual(root["headers"]["Cache-Control"], "no-cache")
        cached = wsgi_get(app, "/", HTTP_IF_NONE_MATCH=root["headers"]["ETag"])
        self.assertEqual(cached["status"], 304)
        asset = wsgi_get(app, "/assets/main-abc12345.js")
        self.assertEqual(asset["status"], 200)
        self.assertIn("javascript", asset["headers"]["Content-Type"])
        self.assertIn("immutable", asset["headers"]["Cache-Control"])
        self.assertNotIn("Access-Control-Allow-Origin", asset["headers"])
        self.assertNotIn("immutable", wsgi_get(app, "/assets/plain.js")["headers"]["Cache-Control"])

    def test_missing_asset_does_not_return_index(self):
        for path in ("/assets/missing.js", "/api/missing/", "/not-a-page"):
            with self.subTest(path=path):
                result = wsgi_get(self.application(), path)
                self.assertEqual(result["status"], 404)
                self.assertEqual(result["body"], b'{"code":"not_found"}')
                self.assertEqual(result["headers"]["Cache-Control"], "no-store")

    def test_missing_index_fails_instead_of_empty_application(self):
        (self.root / "index.html").unlink()
        with self.assertRaisesRegex(ValueError, "index.html"):
            self.application()

    def test_development_wsgi_does_not_serve_built_assets(self):
        app = get_wsgi_application()
        result = wsgi_get(app, "/")
        self.assertEqual(result["status"], 404)


@override_settings(ROOT_URLCONF="project.release_urls", DEBUG=False)
class ReleaseHealthTests(TestCase):
    def test_unknown_api_remains_json_no_store(self):
        response = self.client.get("/api/missing/")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["code"], "not_found")
        self.assertEqual(response["Cache-Control"], "no-store")

    def test_health_accepts_empty_family_without_requiring_identity(self):
        for method in (self.client.get, self.client.head):
            response = method("/healthz/")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response["Cache-Control"], "no-store")
        self.assertEqual(self.client.get("/healthz/").json(), {"status": "ok"})
        self.assertEqual(self.client.post("/healthz/").status_code, 405)

    def test_health_database_failure_is_nonsensitive(self):
        with patch("project.health.connection.cursor", side_effect=OperationalError("sqlite secret path")):
            response = self.client.get("/healthz/")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {"status": "unavailable"})
        self.assertNotContains(response, "sqlite", status_code=503)

import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
from unittest import TestCase


ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "scripts/container_entrypoint.py"
DRIVER = """
import importlib.util, json, os
from unittest.mock import patch
from django.core.management.base import CommandError
spec = importlib.util.spec_from_file_location('container_entrypoint', os.environ['ENTRYPOINT'])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
events = []
def command(name, **kwargs):
    events.append(name)
    if name == os.environ.get('FAIL_COMMAND'):
        raise CommandError('Injected management-command failure')
def execute(program, argv):
    events.append(['exec', program, argv])
with patch('django.core.management.call_command', side_effect=command), patch.object(os, 'execvp', side_effect=execute):
    code = module.main()
mask = os.umask(0o077)
print(json.dumps({'code': code, 'events': events, 'settings': os.environ['DJANGO_SETTINGS_MODULE'], 'umask': mask}))
"""


class ContainerStartupTests(TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.config = self.root / "family.yaml"
        self.config.write_text("members: {alex: Alex}\nevents: {}\n")
        self.dist = self.root / "dist"
        self.dist.mkdir()
        (self.dist / "index.html").write_text("<!doctype html>Wishlist")
        self.data = self.root / "data"
        self.data.mkdir()
        self.secret = secrets.token_hex(32)

    def probe(self, **overrides):
        env = os.environ.copy()
        env.update(ENTRYPOINT=str(SCRIPT), PYTHONPATH=str(ROOT / "backend"),
                   DJANGO_SETTINGS_MODULE="project.settings", DJANGO_SECRET_KEY=self.secret,
                   FAMILY_CONFIG_PATH=str(self.config), FRONTEND_DIST_PATH=str(self.dist),
                   WISHLIST_DB_PATH=str(self.data / "family.sqlite3"))
        env.update(overrides)
        result = subprocess.run([sys.executable, "-c", DRIVER], env=env, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn(self.secret, result.stdout + result.stderr)
        return json.loads(result.stdout), result.stderr

    def test_success_execs_exact_single_worker_contract(self):
        result, _ = self.probe()
        self.assertEqual(result["code"], 0)
        self.assertEqual(result["events"][:2], ["migrate", "sync_family_config"])
        self.assertEqual(result["settings"], "project.release_settings")
        self.assertEqual(result["umask"], 0o077)
        execution = result["events"][2]
        self.assertEqual(execution[:2], ["exec", "gunicorn"])
        argv = execution[2]
        self.assertIn("project.release_wsgi:application", argv)
        for flag, value in (("--workers", "1"), ("--threads", "4"), ("--bind", "0.0.0.0:8000"), ("--forwarded-allow-ips", ""), ("--graceful-timeout", "20")):
            self.assertEqual(argv[argv.index(flag) + 1], value)
        self.assertIn("--no-control-socket", argv)
        self.assertNotIn("--reload", argv)
        self.assertEqual(list(self.data.iterdir()), [])

    def test_preflight_failure_prevents_database_commands(self):
        for value in (self.root / "missing.yaml", self.root):
            with self.subTest(config=value):
                result, error = self.probe(FAMILY_CONFIG_PATH=str(value))
                self.assertNotEqual(result["code"], 0)
                self.assertEqual(result["events"], [])
                self.assertIn("configuration", error.lower())
        self.config.write_text("members: [invalid]\nevents: {}\n")
        result, _ = self.probe()
        self.assertNotEqual(result["code"], 0)
        self.assertEqual(result["events"], [])

    def test_missing_frontend_and_storage_parent_fail_before_migration(self):
        for env in ({"FRONTEND_DIST_PATH": str(self.root / "missing")},
                    {"WISHLIST_DB_PATH": str(self.root / "missing/family.sqlite3")},
                    {"DJANGO_SECRET_KEY": "development-key"}):
            with self.subTest(keys=list(env)):
                result, _ = self.probe(**env)
                self.assertNotEqual(result["code"], 0)
                self.assertEqual(result["events"], [])

    def test_read_only_existing_database_is_not_truncated(self):
        database = self.data / "family.sqlite3"
        database.write_bytes(b"existing data")
        database.chmod(0o400)
        result, _ = self.probe()
        self.assertNotEqual(result["code"], 0)
        self.assertEqual(result["events"], [])
        self.assertEqual(database.read_bytes(), b"existing data")

    def test_unwritable_parent_fails_without_probe_leftovers(self):
        self.data.chmod(0o500)
        try:
            result, _ = self.probe()
            self.assertNotEqual(result["code"], 0)
            self.assertEqual(result["events"], [])
            self.assertEqual(list(self.data.iterdir()), [])
        finally:
            self.data.chmod(0o700)

    def test_migrate_failure_prevents_sync_and_exec(self):
        result, _ = self.probe(FAIL_COMMAND="migrate")
        self.assertNotEqual(result["code"], 0)
        self.assertEqual(result["events"], ["migrate"])

    def test_sync_failure_prevents_exec(self):
        result, _ = self.probe(FAIL_COMMAND="sync_family_config")
        self.assertNotEqual(result["code"], 0)
        self.assertEqual(result["events"], ["migrate", "sync_family_config"])

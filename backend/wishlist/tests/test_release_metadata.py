import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from unittest import TestCase


ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "scripts/release_metadata.py"


def release(tag="v0.1.0", identity=1, **fields):
    return {"id": identity, "tag_name": tag, "draft": False, "prerelease": False,
            "published_at": "2026-10-16T00:00:00Z", **fields}


class ReleaseMetadataTests(TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location("release_metadata", SCRIPT)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)

    def test_versions_sort_numerically(self):
        self.assertGreater(self.module.parse_version("v1.10.0"), self.module.parse_version("v1.9.9"))
        self.assertEqual(self.module.parse_version("v0.1.0"), (0, 1, 0))
        for tag in ("0.1.0", "v01.2.3", "v1.2.3-rc1", "v1.2.3+meta", "v1.2.3\n", "v1.2.3;touch /tmp/a", None):
            with self.subTest(tag=tag), self.assertRaises(ValueError):
                self.module.parse_version(tag)

    def test_first_release_own_id_and_invalid_historical_tags(self):
        current = release()
        self.assertEqual(self.module.validate_release(current, []), "0.1.0")
        self.assertEqual(self.module.validate_release(current, [current, release("old-label", 2)]), "0.1.0")
        self.assertEqual(self.module.validate_release(release("v1.10.0"), [release("v1.9.9", 2)]), "1.10.0")

    def test_old_queued_release_cannot_advance_latest(self):
        for previous in (release("v0.2.0", 2), release("v0.1.0", 2)):
            with self.subTest(tag=previous["tag_name"]), self.assertRaises(ValueError):
                self.module.validate_release(release(), [previous])

    def test_draft_prerelease_unpublished_and_bad_current_fail(self):
        for fields in ({"draft": True}, {"prerelease": True}, {"published_at": None}, {"tag_name": "v1.0.0-rc1"}, {"id": False}):
            with self.subTest(fields=fields), self.assertRaises(ValueError):
                self.module.validate_release(release(**fields), [])

    def test_malformed_history_fails_closed(self):
        for history in (None, {}, [{"tag_name": "v99.0.0"}], [None], ["unexpected"]):
            with self.subTest(history=history), self.assertRaises(ValueError):
                self.module.validate_release(release(), history)

    def test_bundle_pins_only_its_requested_version(self):
        original = (ROOT / ".env.example").read_text()
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "bundle"
            self.module.write_bundle(ROOT, output, "1.10.0")
            self.assertEqual(sorted(path.name for path in output.iterdir()), [".env.example", "compose.yaml", "family.example.yaml"])
            self.assertIn("WISHLIST_VERSION=1.10.0\n", (output / ".env.example").read_text())
            self.assertIn("DJANGO_SECRET_KEY=\n", (output / ".env.example").read_text())
            self.assertEqual((output / "compose.yaml").read_bytes(), (ROOT / "compose.yaml").read_bytes())
            self.assertNotIn(":latest", (output / "compose.yaml").read_text())
        self.assertEqual((ROOT / ".env.example").read_text(), original)

    def test_cli_generates_usable_bundle_and_invalid_history_writes_nothing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            event, history, output = root / "event.json", root / "history.json", root / "bundle"
            event.write_text(json.dumps({"release": release()}))
            for bad in ("", "{}", "null", "not-json"):
                history.write_text(bad)
                result = subprocess.run([sys.executable, str(SCRIPT), "--event", str(event), "--releases", str(history), "--bundle-dir", str(output)], text=True, capture_output=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(output.exists())
            history.write_text("[]")
            result = subprocess.run([sys.executable, str(SCRIPT), "--event", str(event), "--releases", str(history), "--bundle-dir", str(output)], text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip(), "version=0.1.0")
            self.assertTrue((output / "compose.yaml").is_file())

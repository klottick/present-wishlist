from contextlib import redirect_stderr
import importlib.util
from io import StringIO
from pathlib import Path
import subprocess
from unittest import TestCase
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[3] / "scripts/smoke_container.py"


def load_smoke():
    spec = importlib.util.spec_from_file_location("container_smoke", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class SmokeOwnershipTests(TestCase):
    def exercise(self, cleanup_failure=False):
        smoke = load_smoke()
        commands = []

        def command(args, **kwargs):
            commands.append(args)
            if cleanup_failure and args[1] == "stop":
                return subprocess.CompletedProcess(args, 1, "", "injected stop failure")
            return subprocess.CompletedProcess(args, 0, "created\n", "")

        def fail_readiness(runtime, root):
            runtime.create_volume()
            runtime.create([])
            runtime.create([])
            raise RuntimeError("readiness timeout: primary failure")

        error = StringIO()
        with patch.object(smoke, "run_checks", side_effect=fail_readiness), patch.object(smoke.subprocess, "run", side_effect=command), redirect_stderr(error):
            code = smoke.main(["--image", "local:fixture", "--platform", "linux/amd64"])
        return code, commands, error.getvalue()

    def test_readiness_failure_cleans_only_owned_resources(self):
        code, commands, error = self.exercise()
        self.assertNotEqual(code, 0)
        self.assertIn("primary failure", error)
        created_containers = [args[args.index("--name") + 1] for args in commands if args[1] == "create"]
        removed_containers = [args[-1] for args in commands if args[1] == "rm"]
        self.assertEqual(set(created_containers), set(removed_containers))
        self.assertEqual(len(removed_containers), 2)
        self.assertTrue(all(name.startswith("wishlist-smoke-") for name in removed_containers))
        created_volumes = [args[-1] for args in commands if args[1:3] == ["volume", "create"]]
        removed_volumes = [args[-1] for args in commands if args[1:3] == ["volume", "rm"]]
        self.assertEqual(created_volumes, removed_volumes)
        self.assertNotIn("unrelated-data", str(commands))

    def test_cleanup_continues_after_one_resource_failure(self):
        code, commands, error = self.exercise(cleanup_failure=True)
        self.assertNotEqual(code, 0)
        self.assertEqual(sum(args[1] == "rm" for args in commands), 2)
        self.assertEqual(sum(args[1:3] == ["volume", "rm"] for args in commands), 1)
        self.assertIn("cleanup", error.lower())

    def test_primary_failure_is_not_hidden_by_cleanup(self):
        code, _, error = self.exercise(cleanup_failure=True)
        self.assertEqual(code, 1)
        self.assertIn("readiness timeout: primary failure", error)

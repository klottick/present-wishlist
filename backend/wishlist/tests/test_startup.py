import importlib.util
from contextlib import redirect_stderr
from io import StringIO
from pathlib import Path
import tempfile
from unittest import TestCase
from unittest.mock import call, patch


SCRIPT = Path(__file__).resolve().parents[3] / "scripts" / "dev_backend.py"


def load_launcher():
    spec = importlib.util.spec_from_file_location("dev_backend", SCRIPT)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load launcher at {SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class StartupTests(TestCase):
    @patch("subprocess.run")
    def test_migrate_sync_serve_are_ordered_and_share_paths(self, run_mock):
        run_mock.return_value.returncode = 0
        launcher = load_launcher()
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / "family.yaml"
            config.write_text("members: {}\nevents: {}\n", encoding="utf-8")
            database = Path(directory) / "family.sqlite3"

            exit_code = launcher.main(["--config", str(config), "--database", str(database), "--port", "8123"])

            self.assertEqual(exit_code, 0)
            self.assertEqual([entry.args[0][2] for entry in run_mock.call_args_list], ["migrate", "sync_family_config", "runserver"])
            for entry in run_mock.call_args_list:
                env = entry.kwargs["env"]
                self.assertEqual(env["FAMILY_CONFIG_PATH"], str(config.resolve()))
                self.assertEqual(env["WISHLIST_DB_PATH"], str(database.resolve()))
            self.assertEqual(run_mock.call_args_list[-1].args[0][-1], "127.0.0.1:8123")

    @patch("subprocess.run")
    def test_environment_paths_are_used_as_defaults_and_cli_paths_override(self, run_mock):
        run_mock.return_value.returncode = 0
        launcher = load_launcher()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            env_config = root / "env.yaml"
            cli_config = root / "cli.yaml"
            env_database = root / "env.sqlite3"
            cli_database = root / "cli.sqlite3"
            for config in (env_config, cli_config):
                config.write_text("members: {}\nevents: {}\n", encoding="utf-8")
            with patch.dict("os.environ", {
                "FAMILY_CONFIG_PATH": str(env_config),
                "WISHLIST_DB_PATH": str(env_database),
            }):
                self.assertEqual(launcher.main([]), 0)
                self.assertEqual(run_mock.call_args_list[0].kwargs["env"]["FAMILY_CONFIG_PATH"], str(env_config))
                self.assertEqual(run_mock.call_args_list[0].kwargs["env"]["WISHLIST_DB_PATH"], str(env_database))

                run_mock.reset_mock()
                self.assertEqual(launcher.main(["--config", str(cli_config), "--database", str(cli_database)]), 0)
                self.assertEqual(run_mock.call_args_list[0].kwargs["env"]["FAMILY_CONFIG_PATH"], str(cli_config))
                self.assertEqual(run_mock.call_args_list[0].kwargs["env"]["WISHLIST_DB_PATH"], str(cli_database))

    @patch("subprocess.run")
    def test_migration_failure_prevents_sync_and_server_start(self, run_mock):
        run_mock.return_value.returncode = 7
        launcher = load_launcher()

        self.assertEqual(launcher.main([]), 7)

        self.assertEqual([entry.args[0][2] for entry in run_mock.call_args_list], ["migrate"])

    @patch("subprocess.run")
    def test_server_failure_is_returned_without_retry(self, run_mock):
        run_mock.side_effect = [
            type("Result", (), {"returncode": 0})(),
            type("Result", (), {"returncode": 0})(),
            type("Result", (), {"returncode": 9})(),
        ]
        launcher = load_launcher()

        self.assertEqual(launcher.main([]), 9)

        self.assertEqual([entry.args[0][2] for entry in run_mock.call_args_list], ["migrate", "sync_family_config", "runserver"])

    @patch("subprocess.run")
    def test_sync_failure_prevents_server_start(self, run_mock):
        run_mock.side_effect = [type("Result", (), {"returncode": 0})(), type("Result", (), {"returncode": 1})()]
        launcher = load_launcher()

        exit_code = launcher.main([])

        self.assertNotEqual(exit_code, 0)
        self.assertEqual([entry.args[0][2] for entry in run_mock.call_args_list], ["migrate", "sync_family_config"])

    @patch("subprocess.run")
    def test_invalid_configuration_path_fails_before_subprocess(self, run_mock):
        launcher = load_launcher()

        stderr = StringIO()
        with redirect_stderr(stderr):
            exit_code = launcher.main(["--config", "/does/not/exist/family.yaml"])

        self.assertNotEqual(exit_code, 0)
        self.assertIn("configuration must be a readable file", stderr.getvalue())
        run_mock.assert_not_called()

import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
from unittest import TestCase
from unittest.mock import Mock, call, patch


SERVER_SCRIPT = Path(__file__).resolve().parents[3] / "frontend" / "e2e" / "server.py"


def load_e2e_server():
    spec = importlib.util.spec_from_file_location("wishlist_e2e_server", SERVER_SCRIPT)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load e2e server at {SERVER_SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class E2EServerOwnershipTests(TestCase):
    def test_main_creates_missing_temporary_parent_and_cleans_up_run_directory(self):
        server = load_e2e_server()
        with tempfile.TemporaryDirectory() as temporary_directory:
            temporary_parent = Path(temporary_directory) / "missing" / "e2e-runs"
            self.assertFalse(temporary_parent.exists())
            with (
                patch.object(server, "TEMP_ROOT", temporary_parent, create=True),
                patch.object(server, "available_loopback_port", side_effect=[8123, 8124]),
                patch.object(server, "start_backend", return_value=Mock()),
                patch.object(server.subprocess, "Popen", return_value=Mock()),
                patch.object(server, "wait_for_port"),
                patch.object(server, "stop_owned_processes"),
                patch.object(server.STOP_REQUESTED, "is_set", return_value=True),
            ):
                self.assertEqual(server.main(), 0)

            self.assertTrue(temporary_parent.is_dir())
            self.assertEqual(list(temporary_parent.iterdir()), [])

    def test_backend_readiness_failure_stops_the_registered_child(self):
        server = load_e2e_server()
        original_popen = subprocess.Popen
        process = None
        owned = []
        try:
            with (
                patch.object(server, "initialize_backend"),
                patch.object(server.subprocess, "Popen", side_effect=lambda *args, **kwargs: original_popen(
                    [sys.executable, "-c", "import time; time.sleep(60)"]
                )),
                patch.object(server, "wait_for_port", side_effect=RuntimeError("backend readiness timeout")),
            ):
                with self.assertRaisesRegex(RuntimeError, "backend readiness timeout"):
                    server.start_backend(8123, Path("family.yaml"), {}, owned)

            self.assertEqual(len(owned), 1)
            process = owned[0]
            self.assertIsNotNone(process.poll(), "readiness failure must not orphan its child")
        finally:
            if process is not None and process.poll() is None:
                process.terminate()
                process.wait(timeout=5)

    def test_shutdown_attempts_every_tracked_process_even_if_one_stop_fails(self):
        server = load_e2e_server()
        backend = Mock(pid=12345)
        frontend = Mock(pid=12346)
        with patch.object(server, "stop", side_effect=[RuntimeError("frontend stop failed"), None]) as stop:
            with self.assertRaisesRegex(RuntimeError, "Could not stop all owned"):
                server.stop_owned_processes([backend, frontend])

        self.assertEqual(stop.call_args_list, [call(frontend), call(backend)])

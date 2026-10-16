#!/usr/bin/env python3
"""Own an isolated backend/Vite pair for one Playwright viewport run."""

import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time


ROOT = Path(__file__).resolve().parents[2]
TEMP_ROOT = Path("/tmp/opencode")
STOP_REQUESTED = threading.Event()
RESTART_REQUESTED = threading.Event()


def available_loopback_port(excluded: set[int] | None = None) -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    if excluded and port in excluded:
        return available_loopback_port(excluded)
    return port


def stop(process: subprocess.Popen | None) -> None:
    if process is None:
        return
    try:
        if process.poll() is None:
            process.terminate()
    except ProcessLookupError:
        return
    try:
        if process.poll() is None:
            process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        process.kill()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            raise RuntimeError(f"Owned process {process.pid} did not stop after SIGKILL")


def stop_owned_processes(processes: list[subprocess.Popen]) -> None:
    failures = []
    for process in reversed(processes):
        try:
            stop(process)
        except Exception as error:
            failures.append(error)
    if failures:
        raise RuntimeError("Could not stop all owned e2e processes") from failures[0]


def initialize_backend(config: Path, env: dict[str, str]) -> None:
    for command in (
        [sys.executable, str(ROOT / "backend/manage.py"), "migrate", "--noinput"],
        [sys.executable, str(ROOT / "backend/manage.py"), "sync_family_config", "--config", str(config)],
    ):
        subprocess.run(command, cwd=ROOT, env=env, check=True)


def start_backend(port: int, config: Path, env: dict[str, str], owned: list[subprocess.Popen]) -> subprocess.Popen:
    initialize_backend(config, env)
    process = subprocess.Popen(
        [sys.executable, str(ROOT / "backend/manage.py"), "runserver", "--noreload", f"127.0.0.1:{port}"],
        cwd=ROOT,
        env=env,
    )
    # Register ownership before waiting: even an early exit or readiness timeout
    # must leave this exact child available to cleanup.
    owned.append(process)
    try:
        wait_for_port(process, port, "Django")
    except Exception:
        stop(process)
        raise
    return process


def wait_for_port(process: subprocess.Popen, port: int, label: str) -> None:
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"{label} exited early with status {process.returncode}")
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.25):
                return
        except OSError:
            time.sleep(0.2)
    raise RuntimeError(f"Timed out waiting for {label} on port {port}")


def main() -> int:
    backend_port = available_loopback_port()
    frontend_port = available_loopback_port({backend_port})
    backend_origin = f"http://127.0.0.1:{backend_port}"
    frontend_origin = f"http://127.0.0.1:{frontend_port}"
    TEMP_ROOT.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix="family-wishlist-e2e-", dir=TEMP_ROOT))
    config = temporary / "family.yaml"
    database = temporary / "family.sqlite3"
    shutil.copyfile(Path(__file__).with_name("fixtures.yaml"), config)
    env = os.environ.copy()
    env["FAMILY_CONFIG_PATH"] = str(config)
    env["WISHLIST_DB_PATH"] = str(database)
    env["WISHLIST_EXTRA_CSRF_TRUSTED_ORIGIN"] = frontend_origin

    owned: list[subprocess.Popen] = []
    backend: subprocess.Popen | None = None
    frontend: subprocess.Popen | None = None

    try:
        backend = start_backend(backend_port, config, env, owned)
        frontend_env = env.copy()
        frontend_env["VITE_API_TARGET"] = backend_origin
        frontend = subprocess.Popen(
            [str(ROOT / "frontend/node_modules/.bin/vite"), "--host", "127.0.0.1", "--port", str(frontend_port), "--strictPort"],
            cwd=ROOT / "frontend",
            env=frontend_env,
        )
        owned.append(frontend)
        try:
            wait_for_port(frontend, frontend_port, "Vite")
        except Exception:
            stop(frontend)
            raise
        print(json.dumps({"config": str(config), "database": str(database), "url": frontend_origin}), flush=True)
        while not STOP_REQUESTED.is_set():
            if frontend.poll() is not None:
                raise RuntimeError(f"Vite exited unexpectedly with status {frontend.returncode}")
            if backend.poll() is not None:
                raise RuntimeError(f"Django exited unexpectedly with status {backend.returncode}")
            if RESTART_REQUESTED.wait(timeout=0.1):
                RESTART_REQUESTED.clear()
                stop(backend)
                backend = start_backend(backend_port, config, env, owned)
                print("RESTARTED", flush=True)
        return 0
    except Exception as error:
        print(f"e2e server: {error}", file=sys.stderr, flush=True)
        return 1
    finally:
        try:
            stop_owned_processes(owned)
        finally:
            shutil.rmtree(temporary)


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, lambda *_: STOP_REQUESTED.set())
    signal.signal(signal.SIGUSR1, lambda *_: RESTART_REQUESTED.set())
    raise SystemExit(main())

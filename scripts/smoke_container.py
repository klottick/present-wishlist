#!/usr/bin/env python3
"""Exercise a real release image; owns and cleans only this run's resources.

Requires host Python (standard library only) and Docker. It never builds images,
reads real family files, or uses the source-development servers.
"""

import argparse
import http.cookiejar
import json
from pathlib import Path
import re
import secrets
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid


class Docker:
    def __init__(self, image: str, platform: str):
        self.image, self.platform = image, platform
        self.prefix = f"wishlist-smoke-{uuid.uuid4().hex}"
        self.containers = []
        self.volumes = []
        self.counter = 0

    def command(self, *args, check=True):
        result = subprocess.run(["docker", *args], capture_output=True, text=True, timeout=180)
        if check and result.returncode:
            raise RuntimeError(f"Docker {args[0]} failed: {result.stderr.strip()}")
        return result

    def create_volume(self):
        name = self.prefix + "-data"
        self.command("volume", "create", "--label", f"wishlist.smoke={self.prefix}", name)
        self.volumes.append(name)
        return name

    def create(self, options, command=()):
        self.counter += 1
        name = f"{self.prefix}-{self.counter}"
        self.command("create", "--name", name, "--platform", self.platform,
                     "--label", f"wishlist.smoke={self.prefix}", *options, self.image, *command)
        self.containers.append(name)
        return name

    def stop(self, name):
        self.command("stop", "--time", "30", name)
        status = self.command("inspect", "--format", "{{.State.ExitCode}}", name).stdout.strip()
        if status != "0":
            raise RuntimeError(f"Container did not shut down cleanly: exit {status}")

    def remove(self, name):
        self.command("rm", name)
        self.containers.remove(name)

    def cleanup(self):
        clean = True
        for name in reversed(self.containers):
            for args in (("stop", "--time", "30", name), ("rm", name)):
                try:
                    result = self.command(*args, check=False)
                    if result.returncode:
                        clean = False
                        print(f"Smoke cleanup failed for {name}: {result.stderr.strip()}", file=sys.stderr)
                except (OSError, subprocess.SubprocessError) as error:
                    clean = False
                    print(f"Smoke cleanup failed for {name}: {error}", file=sys.stderr)
        for name in reversed(self.volumes):
            try:
                result = self.command("volume", "rm", name, check=False)
                if result.returncode:
                    clean = False
                    print(f"Smoke cleanup failed for {name}: {result.stderr.strip()}", file=sys.stderr)
            except (OSError, subprocess.SubprocessError) as error:
                clean = False
                print(f"Smoke cleanup failed for {name}: {error}", file=sys.stderr)
        return clean


class Session:
    def __init__(self, origin):
        self.origin = origin
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))

    def request(self, path, method="GET", data=None, headers=None, csrf=True):
        request_headers = {"Origin": self.origin, **(headers or {})}
        if method not in {"GET", "HEAD"} and csrf:
            token = next((cookie.value for cookie in self.cookies if cookie.name == "csrftoken"), "")
            request_headers["X-CSRFToken"] = token
        body = None if data is None else json.dumps(data).encode()
        if body is not None:
            request_headers["Content-Type"] = "application/json"
        request = urllib.request.Request(self.origin + path, method=method, data=body, headers=request_headers)
        try:
            response = self.opener.open(request, timeout=5)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, response.headers, response.read()

    def api(self, path, method="GET", data=None, status=200, **kwargs):
        code, headers, body = self.request(path, method, data, **kwargs)
        assert code == status, f"{method} {path}: expected {status}, got {code}: {body[:200]!r}"
        assert headers.get("Cache-Control") == "no-store", f"Private API cache policy lost: {path}"
        assert "application/json" in headers.get("Content-Type", ""), f"Non-JSON API: {path}"
        assert b"Traceback" not in body
        return json.loads(body)


def wait_ready(runtime, name):
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        info = json.loads(runtime.command("inspect", name).stdout)[0]
        if not info["State"]["Running"]:
            break
        if info["State"].get("Health", {}).get("Status") == "healthy":
            port = info["NetworkSettings"]["Ports"]["8000/tcp"][0]["HostPort"]
            return f"http://127.0.0.1:{port}"
        time.sleep(0.2)
    raise RuntimeError("readiness timeout or early container exit")


def run_checks(runtime, root):
    # Probe the uninitialized image through a tracked, short-lived container.
    probe = runtime.create(["--entrypoint", "python"], ["-c", """
import os, pathlib, shutil, stat
assert os.getuid() == 10001
p = pathlib.Path('/data')
assert p.stat().st_uid == 10001 and stat.S_IMODE(p.stat().st_mode) == 0o700
assert not list(p.iterdir())
assert not pathlib.Path('/app/backend/config/family.yaml').exists()
assert not shutil.which('node') and not shutil.which('npm')
"""])
    runtime.command("start", "--attach", probe)
    runtime.remove(probe)

    config = root / "family.yaml"
    config.write_text("members: {alex: Alex, sam: Sam}\nevents: {birthday: Birthday, christmas: Christmas}\n")
    config.chmod(0o444)
    secret_file = root / "runtime.env"
    secret_file.write_text(f"DJANGO_SECRET_KEY={secrets.token_hex(32)}\n")
    secret_file.chmod(0o600)
    volume = runtime.create_volume()
    mounts = ["--mount", f"type=volume,src={volume},dst=/data", "--mount", f"type=bind,src={config},dst=/config/family.yaml,readonly"]

    def start():
        name = runtime.create([*mounts, "--env-file", str(secret_file), "--publish", "127.0.0.1::8000"])
        runtime.command("start", name)
        return name, wait_ready(runtime, name)

    name, origin = start()
    alex, sam = Session(origin), Session(origin)
    code, headers, body = alex.request("/")
    assert code == 200 and b'<div id="root">' in body, "Built frontend not served"
    assert headers.get("Cache-Control") == "no-cache"
    assets = set(re.findall(r'(?:src|href)="(/assets/[^"?#]+\.(?:js|css))"', body.decode()))
    assert assets, "Frontend has no built assets"
    for asset in assets:
        code, headers, body = alex.request(asset)
        assert code == 200 and body, f"Missing compiled asset: {asset}"
        assert "immutable" in headers.get("Cache-Control", ""), f"Asset caching: {asset}"
        assert ("javascript" if asset.endswith(".js") else "text/css") in headers.get("Content-Type", "")
    assert alex.request("/assets/missing.js")[0] == 404
    alex.api("/api/missing/", status=404)
    assert alex.request("/healthz/")[0] == 200
    alex.api("/api/session/")
    sam.api("/api/session/")
    profiles = alex.api("/api/profiles/")
    ids = {profile["key"]: profile["id"] for profile in profiles}
    alex.api("/api/session/", "PUT", {"profile_id": ids["alex"]}, csrf=False, status=403)
    alex.api("/api/session/", "PUT", {"profile_id": ids["alex"]}, headers={"Origin": "http://untrusted.invalid"}, status=403)
    alex.api("/api/session/", "PUT", {"profile_id": ids["alex"]})
    sam.api("/api/session/", "PUT", {"profile_id": ids["sam"]})
    alex.api("/api/session/", headers={"Host": "untrusted.invalid"}, status=400)
    assert alex.api("/api/session/", headers={"X-Forwarded-Proto": "https", "X-Forwarded-Host": "untrusted.invalid"})["profile"]["id"] == ids["alex"]
    item = alex.api("/api/items/", "POST", {"name": "Container smoke gift"}, status=201)
    bought = sam.api(f"/api/items/{item['id']}/purchase/", "PUT", {})
    assert bought["purchases"] == [{"buyer_id": ids["sam"], "buyer_name": "Sam"}]

    def preserved():
        assert alex.api("/api/session/")["profile"]["id"] == ids["alex"], "Session lost on replacement"
        own = alex.api(f"/api/profiles/{ids['alex']}/items/")
        assert len(own) == 1 and own[0]["id"] == item["id"]
        assert not {"purchases", "can_purchase", "can_undo"}.intersection(own[0]), "Recipient purchase leak"
        other = sam.api(f"/api/profiles/{ids['alex']}/items/")
        assert other[0]["purchases"] == bought["purchases"], "Purchase lost"
        assert len(alex.api("/api/profiles/")) == 2, "YAML sync duplicated identities"

    preserved()
    runtime.stop(name)
    runtime.remove(name)
    name, new_origin = start()
    alex.origin = sam.origin = new_origin
    preserved()
    runtime.command("restart", "--time", "30", name)
    alex.origin = sam.origin = wait_ready(runtime, name)
    preserved()
    runtime.stop(name)
    runtime.remove(name)

    invalid = root / "invalid.yaml"
    invalid.write_text("members: [bad]\nevents: {}\n")
    invalid.chmod(0o444)
    for options in (
        ["--mount", f"type=volume,src={volume},dst=/data", "--env-file", str(secret_file)],
        ["--mount", f"type=volume,src={volume},dst=/data", "--mount", f"type=bind,src={invalid},dst=/config/family.yaml,readonly", "--env-file", str(secret_file)],
        mounts,
        ["--mount", f"type=volume,src={volume},dst=/data,readonly", *mounts[2:], "--env-file", str(secret_file)],
    ):
        failed = runtime.create(options)
        runtime.command("start", failed)
        exit_code = runtime.command("wait", failed).stdout.strip()
        assert exit_code not in {"0", "137"}, "Bad configuration/storage did not fail closed"
        logs = runtime.command("logs", failed).stdout
        assert "Listening at:" not in logs
        runtime.remove(failed)
    print(f"PASS {runtime.platform}: frontend/assets, CSRF, privacy, volume/session persistence, fail-closed startup, termination")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True)
    parser.add_argument("--platform", required=True, choices=["linux/amd64", "linux/arm64"])
    args = parser.parse_args(argv)
    runtime = Docker(args.image, args.platform)
    code = 0
    try:
        Path("/tmp/opencode").mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix=runtime.prefix, dir="/tmp/opencode") as temporary:
            run_checks(runtime, Path(temporary))
    except (Exception, KeyboardInterrupt) as error:
        print(f"Container smoke failed: {error}", file=sys.stderr)
        for name in runtime.containers:
            try:
                result = runtime.command("logs", name, check=False)
                print(result.stdout + result.stderr, file=sys.stderr)
            except (OSError, subprocess.SubprocessError):
                pass
        code = 1
    finally:
        if not runtime.cleanup():
            code = 1
    return code


if __name__ == "__main__":
    raise SystemExit(main())

import os
from pathlib import Path
import re
import subprocess
import tempfile
from unittest import TestCase

import yaml


ROOT = Path(__file__).resolve().parents[3]
WORKFLOWS = ROOT / ".github/workflows"


def workflow(name):
    return yaml.load((WORKFLOWS / name).read_text(), Loader=yaml.BaseLoader)


class ReleaseWorkflowTests(TestCase):
    def test_pr_workflow_cannot_publish(self):
        ci = workflow("ci.yaml")
        self.assertEqual(set(ci["on"]), {"push", "pull_request"})
        self.assertEqual(ci["on"]["push"]["branches"], ["main"])
        self.assertEqual(ci["permissions"], {"contents": "read"})
        text = (WORKFLOWS / "ci.yaml").read_text()
        for forbidden in ("packages: write", "docker push", "login-action", "pull_request_target"):
            self.assertNotIn(forbidden, text)
        self.assertIn("linux/arm64", text)
        self.assertIn("bash scripts/verify.sh", text)

    def test_publisher_is_caller_stack_independent(self):
        publish = workflow("publish-image.yaml")
        inputs = publish["on"]["workflow_call"]["inputs"]
        for key in ("image", "version", "smoke-command"):
            self.assertEqual(inputs[key]["required"], "true")
        self.assertEqual(inputs["platforms"]["default"], "linux/amd64,linux/arm64")
        text = (WORKFLOWS / "publish-image.yaml").read_text()
        for specific in ("scripts/smoke_container.py", "release_metadata", "requirements.txt", "manage.py", "npm", "compose.yaml"):
            self.assertNotIn(specific, text)
        self.assertIn("steps.promote.outputs.digest", str(publish))

    def test_release_publication_is_serialized(self):
        release = workflow("release.yaml")
        self.assertEqual(release["on"], {"release": {"types": ["published"]}})
        self.assertEqual(release["concurrency"]["cancel-in-progress"], "false")
        self.assertIn("github.repository", release["concurrency"]["group"])
        self.assertIn("!github.event.release.prerelease", release["jobs"]["prepare"]["if"])
        self.assertIn("!github.event.release.draft", release["jobs"]["prepare"]["if"])
        self.assertEqual(release["jobs"]["publish"]["needs"], ["prepare"])
        self.assertEqual(release["jobs"]["publish"]["permissions"], {"contents": "read", "packages": "write"})

    def test_release_assets_require_successful_publish(self):
        release = workflow("release.yaml")
        self.assertEqual(release["jobs"]["attach"]["needs"], ["prepare", "publish"])
        self.assertEqual(release["jobs"]["attach"]["permissions"], {"contents": "write"})
        self.assertEqual(release["jobs"]["prepare"]["permissions"], {"contents": "read"})
        for name in ("release.yaml", "publish-image.yaml"):
            text = (WORKFLOWS / name).read_text()
            self.assertNotIn("always()", text)
            self.assertNotIn("continue-on-error", text)

    def test_external_actions_are_pinned(self):
        for name in ("ci.yaml", "release.yaml", "publish-image.yaml"):
            document = workflow(name)
            for job in document["jobs"].values():
                for step in job.get("steps", []):
                    if "uses" in step and not step["uses"].startswith("./"):
                        self.assertRegex(step["uses"], r"^[\w./-]+@[a-f0-9]{40}$")

    def test_second_platform_failure_exits_build_step(self):
        publish = workflow("publish-image.yaml")
        steps = publish["jobs"]["publish"]["steps"]
        build = next(step for step in steps if step.get("id") == "build-smoke")
        self.assertIn("set -euo pipefail", build["run"])
        login = next(i for i, step in enumerate(steps) if "login-action" in step.get("uses", ""))
        self.assertGreater(login, steps.index(build))
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            docker = root / "docker"
            docker.write_text('#!/bin/bash\nprintf "%s\\n" "$*" >> "$CALLS"\n')
            docker.chmod(0o700)
            calls = root / "calls"
            env = dict(os.environ, PATH=f"{root}:{os.environ['PATH']}", CALLS=str(calls),
                       IMAGE_BASE="ghcr.io/test/project", VERSION="1.0.0", REVISION="a" * 40,
                       SOURCE="https://github.com/test/project", CONTEXT=".", DOCKERFILE="Dockerfile",
                       PLATFORMS="linux/amd64,linux/arm64", RUN_KEY="42-1",
                       GITHUB_ENV=str(root / "env"), GITHUB_OUTPUT=str(root / "output"),
                       SMOKE_COMMAND='if [[ "$PLATFORM" == linux/arm64 ]]; then exit 17; fi')
            result = subprocess.run(["bash", "-c", build["run"]], env=env, cwd=root, capture_output=True, text=True)
            self.assertEqual(result.returncode, 17, result.stderr)
            recorded = calls.read_text()
            self.assertEqual(recorded.count("buildx build"), 2)
            for forbidden in ("push", "login", "imagetools create"):
                self.assertNotIn(forbidden, recorded)

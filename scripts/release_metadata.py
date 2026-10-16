#!/usr/bin/env python3
"""Validate a stable GitHub release and prepare its source-free install bundle."""

import argparse
import json
from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[1]
VERSION_PATTERN = re.compile(r"v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\Z")


def parse_version(tag: str) -> tuple[int, int, int]:
    match = VERSION_PATTERN.fullmatch(tag) if isinstance(tag, str) else None
    if not match:
        raise ValueError("Release tag must use canonical vMAJOR.MINOR.PATCH syntax.")
    return tuple(int(component) for component in match.groups())


def _check_release(value):
    if (
        not isinstance(value, dict) or type(value.get("id")) is not int or value["id"] <= 0
        or not isinstance(value.get("tag_name"), str)
        or type(value.get("draft")) is not bool or type(value.get("prerelease")) is not bool
        or "published_at" not in value
        or (value["published_at"] is not None and not isinstance(value["published_at"], str))
    ):
        raise ValueError("Malformed GitHub release metadata; refusing to infer version history.")


def validate_release(current: dict, releases: list[dict]) -> str:
    _check_release(current)
    if current["draft"] or current["prerelease"] or not current["published_at"]:
        raise ValueError("Only a published stable release can publish images.")
    version = parse_version(current["tag_name"])
    if not isinstance(releases, list):
        raise ValueError("Release history must be a complete JSON list.")
    for previous in releases:
        _check_release(previous)
        if previous["id"] == current["id"] or previous["draft"] or previous["prerelease"] or not previous["published_at"]:
            continue
        try:
            prior = parse_version(previous["tag_name"])
        except ValueError:
            continue
        if version <= prior:
            raise ValueError("Release version must be greater than every other published stable release.")
    return current["tag_name"][1:]


def write_bundle(source: Path, destination: Path, version: str) -> None:
    parse_version("v" + version)
    files = {name: (source / name).read_bytes() for name in ("compose.yaml", "family.example.yaml", ".env.example")}
    environment, count = re.subn(r"^WISHLIST_VERSION=.*$", f"WISHLIST_VERSION={version}", files[".env.example"].decode(), flags=re.MULTILINE)
    if count != 1 or not re.search(r"^DJANGO_SECRET_KEY=$", environment, re.MULTILINE):
        raise ValueError("Install template must have one version and an empty secret.")
    files[".env.example"] = environment.encode()
    destination.mkdir(parents=True, exist_ok=False)
    for name, content in files.items():
        (destination / name).write_bytes(content)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--event", type=Path, required=True)
    parser.add_argument("--releases", type=Path, required=True)
    parser.add_argument("--bundle-dir", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        event = json.loads(args.event.read_text())
        if not isinstance(event, dict) or "release" not in event:
            raise ValueError("Missing GitHub release event.")
        version = validate_release(event["release"], json.loads(args.releases.read_text()))
        write_bundle(ROOT, args.bundle_dir, version)
        print(f"version={version}")
        return 0
    except (OSError, ValueError) as error:
        print(f"Release preparation failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

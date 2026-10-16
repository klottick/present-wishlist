#!/usr/bin/env python3
"""Migrate, synchronize family YAML, then run Django's local development server."""

import argparse
import os
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parent.parent
MANAGE = ROOT / "backend" / "manage.py"


def port_number(value: str) -> int:
    try:
        port = int(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("port must be an integer from 1 to 65535") from error
    if not 1 <= port <= 65535:
        raise argparse.ArgumentTypeError("port must be an integer from 1 to 65535")
    return port


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=os.environ.get("FAMILY_CONFIG_PATH", ROOT / "backend/config/family.yaml"))
    parser.add_argument("--database", type=Path, default=os.environ.get("WISHLIST_DB_PATH", ROOT / "backend/db.sqlite3"))
    parser.add_argument("--port", type=port_number, default=8000)
    args = parser.parse_args(argv)

    config = args.config.expanduser().resolve()
    database = args.database.expanduser().resolve()
    if not config.is_file() or not os.access(config, os.R_OK):
        print(f"configuration must be a readable file: {config}", file=sys.stderr)
        return 2

    env = os.environ.copy()
    env["FAMILY_CONFIG_PATH"] = str(config)
    env["WISHLIST_DB_PATH"] = str(database)
    commands = (
        [sys.executable, str(MANAGE), "migrate", "--noinput"],
        [sys.executable, str(MANAGE), "sync_family_config", "--config", str(config)],
        [sys.executable, str(MANAGE), "runserver", f"127.0.0.1:{args.port}"],
    )
    for command in commands:
        try:
            result = subprocess.run(command, cwd=ROOT, env=env, check=False)
        except OSError as error:
            print(f"Could not run {command[2]}: {error}", file=sys.stderr)
            return 1
        if result.returncode:
            return result.returncode
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

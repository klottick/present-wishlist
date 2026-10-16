#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

run() {
  printf '\n==> %s\n' "$*"
  "$@"
}

run .venv/bin/python backend/manage.py test wishlist --settings=project.test_settings --keepdb
run .venv/bin/python backend/manage.py check --settings=project.test_settings
run .venv/bin/python backend/manage.py makemigrations --check --dry-run --settings=project.test_settings
run .venv/bin/python -m pip check
run npm --prefix frontend test
run npm --prefix frontend run lint
run npm --prefix frontend run build
run npm --prefix frontend run test:e2e

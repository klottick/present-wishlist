"""Serve only compiled frontend files, never a catch-all application page."""

from pathlib import Path
import re
from wsgiref.types import WSGIApplication

from whitenoise import WhiteNoise


def wrap_frontend(application: WSGIApplication, root: Path) -> WSGIApplication:
    index = root / "index.html"
    try:
        with index.open("rb"):
            pass
    except OSError as error:
        raise ValueError("Built frontend index.html must exist and be readable.") from error

    def headers_for_file(headers, path, url):
        if path.endswith(".html"):
            headers["Cache-Control"] = "no-cache"

    return WhiteNoise(
        application, root=str(root), index_file=True, autorefresh=False,
        allow_all_origins=False, max_age=60,
        immutable_file_test=lambda path, url: bool(re.fullmatch(r"/assets/[^/]+-[A-Za-z0-9_-]{8}\.(?:js|css)", url)),
        add_headers_function=headers_for_file,
    )

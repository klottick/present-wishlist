"""Best-effort public metadata, independent of gift write transactions."""

from datetime import timedelta
from html.parser import HTMLParser
import threading
import time
from urllib.parse import urljoin, urlsplit

from django.utils import timezone

from wishlist.models import LinkPreviewCache
from wishlist.services.public_http import FetchError, fetch_html, public_target

_locks = [threading.Lock() for _ in range(64)]


class MetadataParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.meta = {}
        self.title = ''
        self.in_title = False

    def handle_starttag(self, tag, attrs):
        values = {key.lower(): value for key, value in attrs if value is not None}
        if tag == 'meta':
            key = values.get('property', values.get('name', '')).lower()
            if key in ('og:title', 'og:description', 'og:image', 'description'):
                self.meta.setdefault(key, values.get('content', '')[:4000])
        elif tag == 'title':
            self.in_title = True

    def handle_endtag(self, tag):
        if tag == 'title':
            self.in_title = False

    def handle_data(self, data):
        if self.in_title:
            self.title = (self.title + data)[:300]


def _payload(url, cache=None):
    return {
        'url': url,
        'title': cache.title if cache else '',
        'description': cache.description if cache else '',
        'image_url': cache.image_url or None if cache else None,
        'site_name': urlsplit(url).hostname or url,
        'status': 'ready' if cache and cache.succeeded else 'unavailable',
    }


def preview_for_link(link) -> dict:
    url = link.url
    deadline = time.monotonic() + 8
    lock = _locks[hash(url) % len(_locks)]
    if not lock.acquire(timeout=8):
        return _payload(url)
    try:
        cached = LinkPreviewCache.objects.filter(url=url).first()
        if cached:
            lifetime = timedelta(days=7) if cached.succeeded else timedelta(hours=1)
            if timezone.now() - cached.attempted_at < lifetime:
                return _payload(url, cached)
        values = {'title': '', 'description': '', 'image_url': '', 'succeeded': False}
        try:
            final_url, html = fetch_html(url, deadline=deadline)
            parser = MetadataParser()
            parser.feed(html)
            values['title'] = (parser.meta.get('og:title') or parser.title).strip()[:300]
            values['description'] = (parser.meta.get('og:description') or parser.meta.get('description', '')).strip()[:500]
            image = parser.meta.get('og:image', '').strip()
            if image:
                image = urljoin(final_url, image)
                try:
                    public_target(image, deadline=deadline)
                    values['image_url'] = image
                except FetchError:
                    pass
            values['succeeded'] = bool(values['title'] or values['description'] or values['image_url'])
        except FetchError:
            pass
        cached, _ = LinkPreviewCache.objects.update_or_create(url=url, defaults=values)
        return _payload(url, cached)
    finally:
        lock.release()

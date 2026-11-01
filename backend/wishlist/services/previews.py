"""Best-effort public metadata, independent of gift write transactions."""

from datetime import timedelta
from html.parser import HTMLParser
import threading
import time
from urllib.parse import urljoin, urlsplit

from django.utils import timezone

from wishlist.models import LinkPreviewCache
from wishlist.services.public_http import FetchError, fetch_html, public_target
from wishlist.services.transactions import atomic_mutation

_locks = [threading.Lock() for _ in range(64)]
_preview_slots = threading.BoundedSemaphore(2)
MAX_CACHE_ENTRIES = 512


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
    cached = LinkPreviewCache.objects.filter(url=url).first()
    if _fresh(cached):
        return _payload(url, cached)
    # The release server has four request threads. Leave two available for
    # identity, gift and purchase requests even when destinations are slow.
    if not _preview_slots.acquire(blocking=False):
        return _payload(url, cached)
    deadline = time.monotonic() + 8
    lock = _locks[hash(url) % len(_locks)]
    if not lock.acquire(blocking=False):
        _preview_slots.release()
        return _payload(url, cached)
    try:
        cached = LinkPreviewCache.objects.filter(url=url).first()
        if _fresh(cached):
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
                try:
                    image = urljoin(final_url, image)
                    public_target(image, deadline=deadline)
                    values['image_url'] = image
                except ValueError:
                    pass
            values['succeeded'] = bool(values['title'] or values['description'] or values['image_url'])
        except FetchError:
            pass
        with atomic_mutation():
            cached, _ = LinkPreviewCache.objects.update_or_create(url=url, defaults=values)
            expired = list(LinkPreviewCache.objects.order_by('-attempted_at', '-pk')
                .values_list('pk', flat=True)[MAX_CACHE_ENTRIES:])
            if expired:
                LinkPreviewCache.objects.filter(pk__in=expired).delete()
        return _payload(url, cached)
    finally:
        lock.release()
        _preview_slots.release()


def _fresh(cache) -> bool:
    if cache is None:
        return False
    lifetime = timedelta(days=7) if cache.succeeded else timedelta(hours=1)
    return timezone.now() - cache.attempted_at < lifetime

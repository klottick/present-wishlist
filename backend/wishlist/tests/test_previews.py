from datetime import timedelta
import io
import json
import socket
from unittest.mock import MagicMock, patch

from django.apps import apps
from django.test import SimpleTestCase
from django.utils import timezone

from wishlist.tests.helpers import WishlistTestCase


def dns_result(address='93.184.216.34'):
    family = socket.AF_INET6 if ':' in address else socket.AF_INET
    return [(family, socket.SOCK_STREAM, socket.IPPROTO_TCP, '', (address, 443))]


class PreviewTests(WishlistTestCase):
    def setUp(self):
        super().setUp()
        response = self.client.post('/api/items/', data=json.dumps({'name': 'Book', 'links': ['https://example.com/book']}),
            content_type='application/json', HTTP_X_CSRFTOKEN=self.client.cookies['csrftoken'].value)
        self.link_id = response.json()['links'][0]['id']

    def preview(self):
        return self.client.post(f'/api/item-links/{self.link_id}/preview/', data='{}',
            content_type='application/json', HTTP_X_CSRFTOKEN=self.client.cookies['csrftoken'].value)

    def test_metadata_parsed_relative_image_resolved_and_success_cached(self):
        html = '''<html><head><meta property="og:title" content="A &amp; B"><meta property="og:description" content="Great book">
        <meta property="og:image" content="/cover.jpg"><title>Fallback title</title></head></html>'''
        with patch('wishlist.services.previews.fetch_html', return_value=('https://example.com/final', html)), \
             patch('wishlist.services.public_http.socket.getaddrinfo', return_value=dns_result()):
            first = self.preview()
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json(), {'title': 'A & B', 'description': 'Great book',
            'image_url': 'https://example.com/cover.jpg', 'site_name': 'example.com',
            'url': 'https://example.com/book', 'status': 'ready'})
        with patch('wishlist.services.previews.fetch_html', side_effect=AssertionError('must use cache')):
            self.assertEqual(self.preview().json(), first.json())

    def test_unavailable_result_cached_and_retry_after_hour(self):
        from wishlist.services.public_http import FetchError
        with patch('wishlist.services.previews.fetch_html', side_effect=FetchError('unavailable')):
            response = self.preview()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['status'], 'unavailable')
        self.assertEqual(response.json()['url'], 'https://example.com/book')
        with patch('wishlist.services.previews.fetch_html', side_effect=AssertionError('must use failure cache')):
            self.assertEqual(self.preview().json()['status'], 'unavailable')
        Cache = apps.get_model('wishlist', 'LinkPreviewCache')
        Cache.objects.update(attempted_at=timezone.now() - timedelta(hours=2))
        with patch('wishlist.services.previews.fetch_html', return_value=('https://example.com/', '<title>Retry works</title>')):
            self.assertEqual(self.preview().json()['title'], 'Retry works')

    def test_unsafe_thumbnail_ignored_and_html_title_fallback_is_text(self):
        html = '<title>Fallback &lt;script&gt;</title><meta name="description" content="Description"><meta property="og:image" content="http://127.0.0.1/secret">'
        with patch('wishlist.services.previews.fetch_html', return_value=('https://example.com/', html)), \
             patch('wishlist.services.public_http.socket.getaddrinfo', return_value=dns_result('127.0.0.1')):
            payload = self.preview().json()
        self.assertEqual(payload['title'], 'Fallback <script>')
        self.assertEqual(payload['description'], 'Description')
        self.assertIsNone(payload['image_url'])

    def test_endpoint_requires_csrf_identity_and_active_owner(self):
        endpoint = f'/api/item-links/{self.link_id}/preview/'
        self.assertEqual(self.client.post(endpoint, data='{}', content_type='application/json').status_code, 403)
        self.owner.is_active = False
        self.owner.save(update_fields=['is_active'])
        self.assertEqual(self.preview().status_code, 403)
        from wishlist.tests.helpers import select_profile
        select_profile(self.client, self.buyer)
        self.assertEqual(self.preview().status_code, 404)


class PublicHTTPTests(SimpleTestCase):
    def test_rejects_private_mixed_and_nonstandard_destinations(self):
        from wishlist.services.public_http import UnsafeURL, public_target
        for url in ('file:///etc/passwd', 'https://user:password@example.com/', 'https://example.com:8080/',
                    'http://localhost/', 'http://169.254.169.254/', 'http://[::1]/', 'https://exam\nple.com/'):
            with self.subTest(url=url), patch('wishlist.services.public_http.socket.getaddrinfo', return_value=dns_result('127.0.0.1')):
                with self.assertRaises(UnsafeURL):
                    public_target(url)
        with patch('wishlist.services.public_http.socket.getaddrinfo', return_value=dns_result() + dns_result('10.0.0.1')):
            with self.assertRaises(UnsafeURL):
                public_target('https://example.com/')

    def test_pins_connection_ip_preserves_host_and_tls_name(self):
        from wishlist.services.public_http import PinnedConnection, public_target
        with patch('wishlist.services.public_http.socket.getaddrinfo', return_value=dns_result()):
            target = public_target('https://example.com/book')
        raw = MagicMock()
        context = MagicMock()
        with patch('wishlist.services.public_http.socket.socket', return_value=raw), \
             patch('wishlist.services.public_http.ssl.create_default_context', return_value=context):
            connection = PinnedConnection(target, timeout=2)
            connection.connect()
        self.assertEqual(raw.connect.call_args.args[0], ('93.184.216.34', 443))
        self.assertEqual(context.wrap_socket.call_args.kwargs['server_hostname'], 'example.com')
        self.assertEqual(connection.host, 'example.com')

    def test_redirect_to_private_and_large_pages_fall_back(self):
        from wishlist.services.public_http import FetchError, UnsafeURL, fetch_html
        redirect = MagicMock(status=302)
        redirect.getheader.side_effect = lambda key, default=None: 'http://127.0.0.1/' if key == 'Location' else default
        connection = MagicMock()
        connection.getresponse.return_value = redirect
        with patch('wishlist.services.public_http.socket.getaddrinfo', side_effect=[dns_result(), dns_result('127.0.0.1')]), \
             patch('wishlist.services.public_http.PinnedConnection', return_value=connection):
            with self.assertRaises(UnsafeURL):
                fetch_html('https://example.com/')
        response = MagicMock(status=200)
        response.getheader.side_effect = lambda key, default=None: 'text/html' if key == 'Content-Type' else default
        response.read1 = io.BytesIO(b'x' * (1024 * 1024 + 1)).read
        connection.getresponse.return_value = response
        with patch('wishlist.services.public_http.socket.getaddrinfo', return_value=dns_result()), \
             patch('wishlist.services.public_http.PinnedConnection', return_value=connection):
            with self.assertRaises(FetchError):
                fetch_html('https://example.com/')

    def test_deadline_covers_slow_reads_and_dns(self):
        from wishlist.services.public_http import FetchError, fetch_html
        with patch('wishlist.services.public_http.time.monotonic', side_effect=[0, 9]):
            with self.assertRaises(FetchError):
                fetch_html('https://example.com/')

    def test_rejects_invalid_url_even_when_dns_would_be_public(self):
        from wishlist.services.public_http import UnsafeURL, public_target
        for url in ('https://user:password@example.com/', 'https://example.com:8080/',
                    'https://example.com:0/', 'ftp://example.com/', 'https://exam\nple.com/'):
            with self.subTest(url=url), patch('wishlist.services.public_http.socket.getaddrinfo', return_value=dns_result()):
                with self.assertRaises(UnsafeURL):
                    public_target(url)

    def test_deadline_interrupts_response_even_if_http_client_releases_socket(self):
        from wishlist.services.public_http import PinnedConnection, public_target
        with patch('wishlist.services.public_http.socket.getaddrinfo', return_value=dns_result()):
            target = public_target('http://example.com/')
        raw = MagicMock()
        with patch('wishlist.services.public_http.socket.socket', return_value=raw):
            connection = PinnedConnection(target, timeout=2)
            connection.connect()
        # HTTPConnection detaches its socket when a Connection: close response
        # owns the remaining body. The hard deadline still has to interrupt it.
        connection.sock = None
        connection.expire()
        self.assertTrue(raw.shutdown.called)

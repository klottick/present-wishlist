"""Small, bounded HTML fetcher. Every connection uses a vetted numeric address."""

from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from dataclasses import dataclass
import http.client
import ipaddress
import socket
import ssl
import threading
import time
from urllib.parse import urljoin, urlsplit


class FetchError(ValueError):
    pass


class UnsafeURL(FetchError):
    pass


@dataclass(frozen=True)
class PublicTarget:
    scheme: str
    hostname: str
    port: int
    address: str
    family: int
    path: str


_dns_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix='preview-dns')
_dns_slots = threading.BoundedSemaphore(4)


def remaining(deadline: float) -> float:
    value = deadline - time.monotonic()
    if value <= 0:
        raise FetchError('Preview deadline exceeded.')
    return value


def public_target(url: str, *, deadline: float | None = None) -> PublicTarget:
    if deadline is None:
        deadline = time.monotonic() + 8
    if len(url) > 2000 or any(ord(char) <= 32 or ord(char) == 127 for char in url):
        raise UnsafeURL('Invalid URL.')
    try:
        parsed = urlsplit(url)
        hostname = (parsed.hostname or '').encode('idna').decode('ascii')
        scheme = parsed.scheme.lower()
        port = parsed.port or (443 if scheme == 'https' else 80)
    except (ValueError, UnicodeError) as error:
        raise UnsafeURL('Invalid URL.') from error
    if scheme not in ('http', 'https') or not hostname or parsed.username is not None or parsed.password is not None:
        raise UnsafeURL('Only public HTTP and HTTPS URLs are supported.')
    if port != (443 if scheme == 'https' else 80):
        raise UnsafeURL('Only standard web ports are supported.')
    if not _dns_slots.acquire(blocking=False):
        raise FetchError('DNS resolver is busy.')
    try:
        future = _dns_pool.submit(socket.getaddrinfo, hostname, port, 0, socket.SOCK_STREAM)
    except Exception:
        _dns_slots.release()
        raise
    future.add_done_callback(lambda _: _dns_slots.release())
    try:
        answers = future.result(timeout=min(2, remaining(deadline)))
    except (FutureTimeout, OSError) as error:
        future.cancel()
        raise FetchError('Cannot resolve destination.') from error
    if not answers:
        raise UnsafeURL('Destination has no public addresses.')
    for family, _, _, _, address in answers:
        try:
            ip = ipaddress.ip_address(address[0])
        except ValueError as error:
            raise UnsafeURL('Invalid destination address.') from error
        if family not in (socket.AF_INET, socket.AF_INET6) or not ip.is_global:
            raise UnsafeURL('Destination is not public.')
        if isinstance(ip, ipaddress.IPv6Address) and (
            (ip.ipv4_mapped and not ip.ipv4_mapped.is_global) or ip.sixtofour or ip.teredo
        ):
            raise UnsafeURL('Unsupported destination address.')
    first = answers[0]
    path = parsed.path or '/'
    if parsed.query:
        path += '?' + parsed.query
    return PublicTarget(scheme, hostname, port, first[4][0], first[0], path)


class PinnedConnection(http.client.HTTPConnection):
    def __init__(self, target: PublicTarget, timeout: float):
        super().__init__(target.hostname, target.port, timeout=timeout)
        self.target = target

    def connect(self):
        # socket.connect receives the validated numeric IP; no second DNS lookup.
        raw = socket.socket(self.target.family, socket.SOCK_STREAM)
        self.sock = raw
        try:
            raw.settimeout(self.timeout)
            address = (self.target.address, self.target.port)
            if self.target.family == socket.AF_INET6:
                address = (*address, 0, 0)
            raw.connect(address)
            if self.target.scheme == 'https':
                self.sock = ssl.create_default_context().wrap_socket(raw, server_hostname=self.target.hostname)
        except Exception:
            raw.close()
            self.sock = None
            raise

    def expire(self):
        # shutdown also interrupts HTTPResponse's file object on slow headers/body.
        sock = self.sock
        if sock is not None:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            sock.close()


def fetch_html(url: str, *, deadline: float | None = None) -> tuple[str, str]:
    if deadline is None:
        deadline = time.monotonic() + 8
    current = url
    for redirect in range(4):
        remaining(deadline)
        target = public_target(current, deadline=deadline)
        connection = PinnedConnection(target, timeout=min(2, remaining(deadline)))
        timer = threading.Timer(remaining(deadline), connection.expire)
        timer.daemon = True
        timer.start()
        try:
            connection.request('GET', target.path, headers={
                'User-Agent': 'FamilyWishlist/1.0 (link preview)',
                'Accept': 'text/html, application/xhtml+xml', 'Accept-Encoding': 'identity',
            })
            response = connection.getresponse()
            remaining(deadline)
            if response.status in (301, 302, 303, 307, 308):
                location = response.getheader('Location')
                if redirect == 3 or not location:
                    raise FetchError('Too many redirects or missing destination.')
                current = urljoin(current, location)
                continue
            content_type = response.getheader('Content-Type', '').split(';', 1)[0].strip().lower()
            if response.status != 200 or content_type not in ('text/html', 'application/xhtml+xml'):
                raise FetchError('Destination does not provide an HTML page.')
            if response.getheader('Content-Encoding', 'identity').lower() != 'identity':
                raise FetchError('Compressed responses are unsupported.')
            length = response.getheader('Content-Length')
            if length and int(length) > 1024 * 1024:
                raise FetchError('Preview page is too large.')
            body = bytearray()
            while True:
                remaining(deadline)
                if connection.sock is not None:
                    connection.sock.settimeout(min(2, remaining(deadline)))
                chunk = response.read1(min(32768, 1024 * 1024 + 1 - len(body)))
                if not chunk:
                    break
                body.extend(chunk)
                if len(body) > 1024 * 1024:
                    raise FetchError('Preview page is too large.')
            remaining(deadline)
            charset = response.headers.get_content_charset() or 'utf-8'
            try:
                html = bytes(body).decode(charset, errors='replace')
            except LookupError:
                html = bytes(body).decode('utf-8', errors='replace')
            return current, html
        except (OSError, http.client.HTTPException, ValueError, UnicodeError) as error:
            if isinstance(error, FetchError):
                raise
            raise FetchError('Preview could not be fetched.') from error
        finally:
            timer.cancel()
            connection.close()
    raise FetchError('Too many redirects.')

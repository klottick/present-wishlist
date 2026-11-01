import io

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client
from django.test.client import BOUNDARY, MULTIPART_CONTENT, encode_multipart
from PIL import Image

from wishlist.tests.helpers import WishlistTestCase, select_profile


def image_upload(format='PNG', color='navy', size=(320, 160), **options):
    output = io.BytesIO()
    Image.new('RGB', size, color).save(output, format=format, **options)
    return SimpleUploadedFile('photo.bin', output.getvalue(), content_type='application/octet-stream')


class AvatarTests(WishlistTestCase):
    def upload(self, image, csrf=True):
        return self.client.put(
            '/api/profile/avatar/', encode_multipart(BOUNDARY, {'photo': image}),
            content_type=MULTIPART_CONTENT,
            **({'HTTP_X_CSRFTOKEN': self.client.cookies['csrftoken'].value} if csrf else {}),
        )

    def test_upload_normalizes_and_public_picker_can_read_photo(self):
        exif = Image.Exif()
        exif[270] = 'Private original description'
        response = self.upload(image_upload('JPEG', exif=exif))
        self.assertEqual(response.status_code, 200)
        url = response.json()['avatar_url']
        self.assertIn(f'/api/profiles/{self.owner.pk}/avatar/?v=', url)
        public = Client().get(url)
        self.assertEqual(public.status_code, 200)
        self.assertEqual(public['Content-Type'], 'image/jpeg')
        self.assertEqual(public['X-Content-Type-Options'], 'nosniff')
        self.assertIn('max-age=', public['Cache-Control'])
        photo = Image.open(io.BytesIO(public.content))
        self.assertEqual(photo.size, (256, 256))
        self.assertFalse(photo.getexif())
        self.assertEqual(Client().get(url, HTTP_IF_NONE_MATCH=public['ETag']).status_code, 304)
        profiles = self.client.get('/api/profiles/').json()
        self.assertEqual(next(p for p in profiles if p['id'] == self.owner.pk)['avatar_url'], url)

    def test_replace_and_remove_only_selected_profile(self):
        first = self.upload(image_upload()).json()['avatar_url']
        second = self.upload(image_upload('WEBP', color='red')).json()['avatar_url']
        self.assertNotEqual(first, second)
        self.assertNotEqual(Client().get(first).status_code, 304)
        select_profile(self.client, self.buyer)
        self.assertIsNone(self.client.get('/api/session/').json()['profile']['avatar_url'])
        select_profile(self.client, self.owner)
        removed = self.client.delete('/api/profile/avatar/', HTTP_X_CSRFTOKEN=self.client.cookies['csrftoken'].value)
        self.assertEqual(removed.status_code, 200)
        self.assertIsNone(removed.json()['avatar_url'])
        self.assertEqual(Client().get(second).status_code, 404)

    def test_bad_uploads_preserve_saved_image(self):
        saved = self.upload(image_upload()).json()['avatar_url']
        animated = io.BytesIO()
        Image.new('RGB', (4, 4), 'red').save(animated, format='PNG', save_all=True,
            append_images=[Image.new('RGB', (4, 4), 'blue')])
        bad_uploads = [
            SimpleUploadedFile('bad.jpg', b'not an image', content_type='image/jpeg'),
            SimpleUploadedFile('bad.svg', b'<svg></svg>', content_type='image/svg+xml'),
            SimpleUploadedFile('big.png', b'x' * (5 * 1024 * 1024 + 1)),
            SimpleUploadedFile('animated.png', animated.getvalue()),
            image_upload(size=(6000, 4000)),
        ]
        for upload in bad_uploads:
            with self.subTest(name=upload.name):
                response = self.upload(upload)
                self.assertEqual(response.status_code, 400)
                self.assertIn('photo', response.json()['fields'])
                self.assertEqual(self.client.get('/api/session/').json()['profile']['avatar_url'], saved)

    def test_requires_identity_and_csrf_and_hides_archived_photo(self):
        self.assertEqual(self.upload(image_upload(), csrf=False).status_code, 403)
        saved = self.upload(image_upload()).json()['avatar_url']
        self.owner.is_active = False
        self.owner.save(update_fields=['is_active'])
        self.assertEqual(Client().get(saved).status_code, 404)
        self.assertEqual(self.upload(image_upload()).status_code, 403)
        self.assertEqual(Client().get(f'/api/profiles/{self.buyer.pk}/avatar/').status_code, 404)

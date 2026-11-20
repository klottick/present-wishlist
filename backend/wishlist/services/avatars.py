"""Normalize untrusted profile images before storing any bytes."""

from io import BytesIO
import warnings
from uuid import uuid4

from PIL import Image, ImageOps, UnidentifiedImageError
from rest_framework.exceptions import ValidationError

from wishlist.models import FamilyProfile
from wishlist.services.transactions import atomic_mutation

MAX_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_PIXELS = 20_000_000


def normalize_avatar(upload) -> bytes:
    if upload is None or not hasattr(upload, 'read'):
        raise ValidationError({'photo': ['Choose a JPEG, PNG, or WebP photo.']})
    raw = upload.read(MAX_UPLOAD_BYTES + 1)
    if not raw or len(raw) > MAX_UPLOAD_BYTES:
        raise ValidationError({'photo': ['Choose a photo no larger than 5 MB.']})
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(BytesIO(raw), formats=('JPEG', 'PNG', 'WEBP')) as image:
                if image.width * image.height > MAX_PIXELS or getattr(image, 'n_frames', 1) != 1:
                    raise ValueError('Image must be still and at most 20 megapixels.')
                image.load()
                oriented = ImageOps.exif_transpose(image)
                rgba = ImageOps.fit(oriented, (256, 256), method=Image.Resampling.LANCZOS).convert('RGBA')
                result = Image.new('RGB', (256, 256), '#edf5ef')
                result.paste(rgba, mask=rgba.getchannel('A'))
                output = BytesIO()
                result.save(output, format='JPEG', quality=85, optimize=True)
                return output.getvalue()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombWarning, Image.DecompressionBombError) as error:
        raise ValidationError({'photo': ['Choose a valid, still JPEG, PNG, or WebP photo of at most 20 megapixels.']}) from error


def save_avatar(profile: FamilyProfile, data: bytes) -> FamilyProfile:
    with atomic_mutation():
        current = FamilyProfile.objects.get(pk=profile.pk, is_active=True)
        current.avatar_data = data
        current.avatar_version = uuid4().hex if data else ''
        current.save(update_fields=('avatar_data', 'avatar_version'))
        return current

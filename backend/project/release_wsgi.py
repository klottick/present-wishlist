import os

from django.conf import settings
from django.core.wsgi import get_wsgi_application

from .frontend_static import wrap_frontend


os.environ.setdefault("DJANGO_SETTINGS_MODULE", "project.release_settings")
application = wrap_frontend(get_wsgi_application(), settings.FRONTEND_DIST_PATH)

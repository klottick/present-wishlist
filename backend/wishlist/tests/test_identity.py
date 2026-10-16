from django.test import Client, TestCase, override_settings
from django.urls import path
from django.contrib.auth import get_user_model
from django.core.exceptions import PermissionDenied
from django.http import Http404
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError

from wishlist.api.base import FamilyAPIView
from wishlist.tests.helpers import make_profile


class IdentityTests(TestCase):
    def setUp(self):
        self.profile = make_profile("alex", "Alex")
        self.client = Client(enforce_csrf_checks=True)

    def test_selects_configured_profile_without_login(self):
        bootstrap = self.client.get("/api/session/")
        self.assertEqual(bootstrap.json(), {"profile": None})
        self.assertIn("csrftoken", bootstrap.cookies)

        token = bootstrap.cookies["csrftoken"].value
        rejected = self.client.put(
            "/api/session/",
            data='{"profile_id": %d}' % self.profile.pk,
            content_type="application/json",
        )
        self.assertEqual((rejected.status_code, rejected.json()["code"]), (403, "csrf_failed"))

        confirmed = self.client.put(
            "/api/session/",
            data='{"profile_id": %d}' % self.profile.pk,
            content_type="application/json",
            HTTP_X_CSRFTOKEN=token,
        )
        self.assertEqual(confirmed.status_code, 200)
        self.assertEqual(confirmed.json()["profile"]["id"], self.profile.pk)
        self.assertIsNone(self.client.session.get("_auth_user_id"))
        self.assertEqual(self.client.get("/api/session/").json()["profile"]["id"], self.profile.pk)

    def test_selection_requires_csrf_even_without_django_user(self):
        response = self.client.put(
            "/api/session/",
            data='{"profile_id": %d}' % self.profile.pk,
            content_type="application/json",
        )
        self.assertEqual((response.status_code, response.json()["code"]), (403, "csrf_failed"))

    def test_clear_and_refresh_session(self):
        bootstrap = self.client.get("/api/session/")
        token = bootstrap.cookies["csrftoken"].value
        self.client.put(
            "/api/session/",
            data='{"profile_id": %d}' % self.profile.pk,
            content_type="application/json",
            HTTP_X_CSRFTOKEN=token,
        )
        refreshed = self.client.put(
            "/api/session/",
            data='{"profile_id": %d}' % self.profile.pk,
            content_type="application/json",
            HTTP_X_CSRFTOKEN=token,
        )
        cleared = self.client.delete("/api/session/", HTTP_X_CSRFTOKEN=token)
        self.assertEqual(refreshed.json()["profile"]["id"], self.profile.pk)
        self.assertEqual(cleared.json(), {"profile": None})
        self.assertIsNone(self.client.session.get("family_profile_id"))

    def test_inactive_or_missing_selection_returns_null(self):
        inactive = make_profile("inactive", "Inactive")
        inactive.is_active = False
        inactive.save(update_fields=("is_active",))
        bootstrap = self.client.get("/api/session/")
        token = bootstrap.cookies["csrftoken"].value
        for profile_id in (inactive.pk, 99999):
            response = self.client.put(
                "/api/session/",
                data='{"profile_id": %d}' % profile_id,
                content_type="application/json",
                HTTP_X_CSRFTOKEN=token,
            )
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json()["code"], "validation_error")
            self.assertIsNone(self.client.get("/api/session/").json()["profile"])

    def test_stale_session_is_cleared_without_substitute(self):
        session = self.client.session
        session["family_profile_id"] = 99999
        session.save()

        response = self.client.get("/api/session/")

        self.assertEqual(response.json(), {"profile": None})
        self.assertNotIn("family_profile_id", self.client.session)

    def test_linked_future_user_does_not_change_name_picker(self):
        user = get_user_model().objects.create_user(username="alex-login")
        self.profile.user = user
        self.profile.save(update_fields=("user",))

        bootstrap = self.client.get("/api/session/")
        token = bootstrap.cookies["csrftoken"].value
        selected = self.client.put(
            "/api/session/",
            data='{"profile_id": %d}' % self.profile.pk,
            content_type="application/json",
            HTTP_X_CSRFTOKEN=token,
        )

        self.assertEqual(selected.json()["profile"]["name"], "Alex")
        self.assertFalse(self.client.session.get("_auth_user_id"))

    def test_malformed_selection_is_validation_error(self):
        token = self.client.get("/api/session/").cookies["csrftoken"].value
        response = self.client.put(
            "/api/session/",
            data='{"profile_id": "not-an-id"}',
            content_type="application/json",
            HTTP_X_CSRFTOKEN=token,
        )
        self.assertEqual((response.status_code, response.json()["code"]), (400, "validation_error"))

    def test_missing_identity_is_forbidden_on_protected_view(self):
        class ProtectedView(FamilyAPIView):
            def get(self, request):
                profile = self.require_profile(request)
                return Response({"id": profile.pk})

        with override_settings(ROOT_URLCONF=type("TestUrls", (), {"urlpatterns": [path("api/protected/", ProtectedView.as_view())]})):
            response = self.client.get("/api/protected/")
        self.assertEqual((response.status_code, response.json()["code"]), (403, "identity_required"))

    def test_django_http404_is_normalized_and_not_cached(self):
        class MissingView(FamilyAPIView):
            def get(self, request):
                raise Http404

        test_urls = type(
            "TestUrls", (), {"urlpatterns": [path("api/missing/", MissingView.as_view())]}
        )
        with override_settings(ROOT_URLCONF=test_urls):
            response = self.client.get("/api/missing/")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"code": "not_found", "message": "Not found."})
        self.assertEqual(response["Cache-Control"], "no-store")

    def test_django_permission_denied_is_normalized_and_not_cached(self):
        class DeniedView(FamilyAPIView):
            def get(self, request):
                raise PermissionDenied

        test_urls = type(
            "TestUrls", (), {"urlpatterns": [path("api/denied/", DeniedView.as_view())]}
        )
        with override_settings(ROOT_URLCONF=test_urls):
            response = self.client.get("/api/denied/")

        self.assertEqual(response.status_code, 403)
        self.assertEqual(
            response.json(),
            {"code": "forbidden", "message": "You do not have permission to perform this action."},
        )
        self.assertEqual(response["Cache-Control"], "no-store")

    def test_validation_error_fields_survive_api_failure_normalization(self):
        class InvalidView(FamilyAPIView):
            def get(self, request):
                raise ValidationError({"name": ["This field is invalid."]})

        test_urls = type(
            "TestUrls", (), {"urlpatterns": [path("api/invalid/", InvalidView.as_view())]}
        )
        with override_settings(ROOT_URLCONF=test_urls):
            response = self.client.get("/api/invalid/")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.json(),
            {
                "code": "validation_error",
                "message": "Invalid request.",
                "fields": {"name": ["This field is invalid."]},
            },
        )
        self.assertEqual(response["Cache-Control"], "no-store")


class IdentitySerializationTests(TestCase):
    def test_profile_serialization_uses_public_field_names(self):
        profile = make_profile("sam", "Sam")
        from wishlist.serialization import serialize_profile

        self.assertEqual(serialize_profile(profile), {"id": profile.pk, "key": "sam", "name": "Sam"})

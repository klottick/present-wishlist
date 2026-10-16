from django.test import Client, TestCase

from wishlist.models import Event
from wishlist.tests.helpers import make_event, make_profile


class CatalogTests(TestCase):
    def setUp(self):
        self.client = Client(enforce_csrf_checks=True)

    def test_catalog_excludes_archived_records(self):
        make_profile("zoe", "Zoe")
        make_profile("alex", "alex")
        archived = make_profile("sam", "Sam")
        archived.is_active = False
        archived.save(update_fields=("is_active",))
        make_event("z-event", "Zebra")
        make_event("a-event", "alpha")
        archived_event = make_event("old", "Old", active=False)

        profiles = self.client.get("/api/profiles/")
        events = self.client.get("/api/events/")

        self.assertEqual([entry["name"] for entry in profiles.json()], ["alex", "Zoe"])
        self.assertEqual([entry["label"] for entry in events.json()], ["alpha", "Zebra"])
        self.assertNotIn(archived_event.pk, [entry["id"] for entry in events.json()])

    def test_profiles_events_are_read_only(self):
        profile = make_profile("alex", "Alex")
        make_event("birthday", "Birthday")
        bootstrap = self.client.get("/api/session/")
        token = bootstrap.cookies["csrftoken"].value

        for endpoint in ("/api/profiles/", "/api/events/"):
            response = self.client.post(endpoint, data="{}", content_type="application/json", HTTP_X_CSRFTOKEN=token)
            self.assertEqual(response.status_code, 405)
            self.assertEqual(response["Content-Type"], "application/json")
            self.assertEqual(response["Cache-Control"], "no-store")

        self.assertEqual(profile.name, "Alex")
        self.assertEqual(Event.objects.count(), 1)

    def test_all_api_responses_are_json_and_no_store(self):
        bootstrap = self.client.get("/api/session/")
        token = bootstrap.cookies["csrftoken"].value
        responses = [
            self.client.get("/api/session/"),
            self.client.get("/api/not-a-route/"),
            self.client.post("/api/session/", data="{}", content_type="application/json", HTTP_X_CSRFTOKEN=token),
            self.client.put("/api/session/", data="{}", content_type="application/json"),
            self.client.get("/api/profiles/", HTTP_ACCEPT="text/html"),
        ]
        for response in responses:
            self.assertTrue(response["Content-Type"].startswith("application/json"))
            self.assertEqual(response["Cache-Control"], "no-store")
        self.assertEqual(responses[1].status_code, 404)
        self.assertEqual(responses[2].status_code, 405)
        self.assertEqual((responses[3].status_code, responses[3].json()["code"]), (403, "csrf_failed"))
        self.assertEqual(responses[4].status_code, 406)

    def test_events_include_only_real_configured_events(self):
        event = make_event("birthday", "Birthday")
        response = self.client.get("/api/events/")
        self.assertEqual(response.json(), [{"id": event.pk, "key": "birthday", "label": "Birthday", "is_active": True}])

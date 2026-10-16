from django.test import Client, TestCase

from wishlist.tests.helpers import WishlistTestCase, make_profile, select_profile


class SharedHelperTests(TestCase):
    def test_select_profile_uses_csrf_bootstrap_and_real_session_endpoint(self):
        profile = make_profile("alex", "Alex")
        client = Client(enforce_csrf_checks=True)

        selected = select_profile(client, profile)

        self.assertEqual(selected.status_code, 200)
        self.assertIn("csrftoken", client.cookies)
        self.assertEqual(client.session["family_profile_id"], profile.pk)
        self.assertEqual(client.get("/api/session/").json(), {
            "profile": {"id": profile.pk, "key": "alex", "name": "Alex"}
        })
        self.assertNotIn("_auth_user_id", client.session)


class WishlistFixtureTests(WishlistTestCase):
    def test_shared_wishlist_fixture_has_expected_profiles_and_selected_owner(self):
        self.assertEqual(self.owner.name, "Alex")
        self.assertEqual(self.buyer.name, "Sam")
        self.assertEqual(self.other.name, "Robin")
        self.assertEqual(self.item.owner_id, self.owner.pk)
        self.assertIsNone(self.item.event_id)
        self.assertEqual(self.client.get("/api/session/").json()["profile"]["id"], self.owner.pk)

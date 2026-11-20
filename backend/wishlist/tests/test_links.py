import json

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase

from wishlist.models import Purchase
from wishlist.tests.helpers import WishlistTestCase, select_profile


class LinkTests(WishlistTestCase):
    def send(self, data, item_id=None):
        method = self.client.patch if item_id else self.client.post
        return method(f'/api/items/{item_id}/' if item_id else '/api/items/',
            data=json.dumps(data), content_type='application/json',
            HTTP_X_CSRFTOKEN=self.client.cookies['csrftoken'].value)

    def test_ordered_links_trim_preserve_ids_and_purchases(self):
        response = self.send({'name': 'Book', 'links': [' https://example.com/a ', 'https://shop.example/b']})
        self.assertEqual(response.status_code, 201)
        item = response.json()
        self.assertEqual([link['url'] for link in item['links']], ['https://example.com/a', 'https://shop.example/b'])
        self.assertEqual(item['link'], 'https://example.com/a')
        Purchase.objects.create(item_id=item['id'], buyer=self.buyer)
        updated = self.send({'links': ['https://shop.example/b', 'https://example.com/a']}, item['id'])
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json()['links'], list(reversed(item['links'])))
        self.assertEqual(Purchase.objects.filter(item_id=item['id']).count(), 1)
        self.assertNotIn('purchases', updated.json())

    def test_zero_ten_and_invalid_links(self):
        for links in ([], [' ', ''], [f'https://example.com/{i}' for i in range(10)]):
            with self.subTest(links=links):
                response = self.send({'name': 'Book', 'links': links})
                self.assertEqual(response.status_code, 201)
                self.assertEqual(len(response.json()['links']), len([url for url in links if url.strip()]))
        for links in (['https://example.com/a'] * 2, ['javascript:alert(1)'],
                      ['https://example.com/' + 'a' * 2000], [None], 'https://example.com',
                      [f'https://example.com/{i}' for i in range(11)]):
            with self.subTest(links=links):
                self.assertEqual(self.send({'name': 'Book', 'links': links}).status_code, 400)
        invalid_row = self.send({'name': 'Book', 'links': ['https://example.com/a', 'bad']})
        self.assertIn('links.1', invalid_row.json()['fields'])

    def test_legacy_write_replaces_list_and_cannot_mix_fields(self):
        created = self.send({'name': 'Book', 'link': 'https://example.com/a'}).json()
        self.assertIn('links', created)
        self.assertEqual([row['url'] for row in created['links']], ['https://example.com/a'])
        item_id = created['id']
        self.assertEqual(self.send({'link': '', 'links': []}, item_id).status_code, 400)
        self.assertEqual(self.send({'link': ''}, item_id).json()['links'], [])

    def test_validation_and_ownership_do_not_change_links(self):
        created = self.send({'name': 'Book', 'links': ['https://example.com/a']})
        self.assertEqual(created.status_code, 201)
        item = created.json()
        self.assertEqual(self.send({'name': 'Changed', 'links': ['bad']}, item['id']).status_code, 400)
        current = self.client.get(f"/api/items/{item['id']}/").json()
        self.assertEqual(current, item)
        select_profile(self.client, self.buyer)
        self.assertEqual(self.send({'links': []}, item['id']).status_code, 403)


class LinkMigrationTests(TransactionTestCase):
    def test_existing_link_is_migrated_without_changing_item_or_purchase(self):
        executor = MigrationExecutor(connection)
        latest = executor.loader.graph.leaf_nodes()
        try:
            executor.migrate([('wishlist', '0002_wishlistitem_demo_key')])
            old = executor.loader.project_state([('wishlist', '0002_wishlistitem_demo_key')]).apps
            owner = old.get_model('wishlist', 'FamilyProfile').objects.create(config_key='migration-owner', name='Owner')
            buyer = old.get_model('wishlist', 'FamilyProfile').objects.create(config_key='migration-buyer', name='Buyer')
            item = old.get_model('wishlist', 'WishlistItem').objects.create(owner=owner, name='Book', link='https://example.com/book')
            mark = old.get_model('wishlist', 'Purchase').objects.create(item=item, buyer=buyer)
            executor = MigrationExecutor(connection)
            executor.migrate(latest)
            new = executor.loader.project_state(latest).apps
            links = new.get_model('wishlist', 'WishlistItemLink').objects.filter(item_id=item.pk)
            self.assertEqual(list(links.values_list('url', 'position')), [('https://example.com/book', 0)])
            self.assertTrue(new.get_model('wishlist', 'Purchase').objects.filter(pk=mark.pk, item_id=item.pk).exists())
        finally:
            MigrationExecutor(connection).migrate(latest)

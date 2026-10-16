import type { EventOption, Item, ItemInput, OwnerItem, Profile, Session } from '../api/types'

export const profileFixture: Profile = { id: 1, key: 'alex', name: 'Alex' }
export const sessionFixture: Session = { profile: profileFixture }
export const eventFixture: EventOption = {
  id: 1,
  key: 'birthday',
  label: 'Birthday',
  is_active: true,
}
export const itemInputFixture: ItemInput = {
  name: 'Book',
  link: '',
  price: '',
  notes: '',
  event_id: null,
  allow_multiple_purchases: false,
}
export const ownerItemFixture: OwnerItem = {
  id: 1,
  owner_id: 1,
  name: 'Book',
  link: '',
  price: '',
  notes: '',
  event: null,
  allow_multiple_purchases: false,
  created_at: '2026-10-15T10:00:00Z',
  updated_at: '2026-10-15T10:00:00Z',
  is_owner: true,
}
export const otherItemFixture: Item = {
  ...ownerItemFixture,
  is_owner: false,
  purchases: [],
  can_purchase: true,
  can_undo: false,
}

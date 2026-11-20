export type Profile = { id: number; key: string; name: string; avatar_url?: string | null }
export type GiftLink = { id: number; url: string }
export type LinkMetadata = { url: string; title: string; description: string; image_url: string | null; site_name: string; status: 'ready' | 'unavailable' }
export type EventOption = { id: number; key: string; label: string; is_active: boolean }
export type Session = { profile: Profile | null }
export type Buyer = { buyer_id: number; buyer_name: string }
export type ItemBase = {
  id: number
  owner_id: number
  name: string
  link: string
  links?: GiftLink[]
  price: string
  notes: string
  event: EventOption | null
  allow_multiple_purchases: boolean
  created_at: string
  updated_at: string
}
export type OwnerItem = ItemBase & { is_owner: true }
export type OtherItem = ItemBase & {
  is_owner: false
  purchases: Buyer[]
  can_purchase: boolean
  can_undo: boolean
}
export type Item = OwnerItem | OtherItem
export type ItemInput = {
  name: string
  link?: string
  links?: string[]
  price?: string
  notes: string
  event_id: number | null
  allow_multiple_purchases: boolean
}
export type EventFilterValue = 'all' | 'anything' | { key: string }
export type ApiFailure = { code: string; message: string; fields?: Record<string, string[]> }

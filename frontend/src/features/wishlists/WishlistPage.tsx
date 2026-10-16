import { useEffect, useRef, useState } from 'react'
import { ApiError, getEvents } from '../../api/client'
import type { EventFilterValue, EventOption, Profile } from '../../api/types'
import { AsyncState } from '../../components/AsyncState'
import { useIdentity } from '../identity/IdentityProvider'
import { EventFilter } from './EventFilter'
import { GiftCard } from './GiftCard'
import { PurchaseControls } from './PurchaseControls'
import { useWishlist } from './useWishlist'
import type { OwnerItem } from '../../api/types'
import { ItemForm } from '../items/ItemForm'
import { DeleteItemDialog } from '../items/DeleteItemDialog'

export function WishlistPage({ owner }: { owner: Profile }) {
  const { generation, phase, profile } = useIdentity()
  const [purchaseConflict, setPurchaseConflict] = useState<{ generation: number; ownerId: number; refreshVersion: number } | null>(null)
  const [filter, setFilter] = useState<EventFilterValue>('all')
  const [events, setEvents] = useState<EventOption[]>([])
  const [eventsLoading, setEventsLoading] = useState(true)
  const [eventsGeneration, setEventsGeneration] = useState<number | null>(null)
  const [eventsError, setEventsError] = useState<string | null>(null)
  const [eventRetryVersion, setEventRetryVersion] = useState(0)
  const [editingItem, setEditingItem] = useState<OwnerItem | 'new' | null>(null)
  const [deletingItem, setDeletingItem] = useState<OwnerItem | null>(null)
  const page = useRef<HTMLElement>(null)
  const catalogLoading = eventsLoading || eventsGeneration !== generation
  const filterIsAvailable = filter === 'all' || filter === 'anything'
    || events.some((event) => event.is_active && event.key === filter.key)
  const visibleFilter = !catalogLoading && !eventsError && !filterIsAvailable ? 'all' : filter
  const wishlist = useWishlist(owner.id, visibleFilter, generation, !catalogLoading && !eventsError)

  useEffect(() => {
    const controller = new AbortController()
    let current = true
    setEventsLoading(true)
    setEventsError(null)
    getEvents(controller.signal).then((available) => {
      if (!current) return
      setEvents(available)
      setEventsGeneration(generation)
      setEventsLoading(false)
    }).catch((reason: unknown) => {
      if (!current || controller.signal.aborted) return
      setEventsError(reason instanceof ApiError ? reason.message : 'We could not load occasions. Please try again.')
      setEventsGeneration(generation)
      setEventsLoading(false)
    })
    return () => {
      current = false
      controller.abort()
    }
  }, [generation, eventRetryVersion])

  useEffect(() => setFilter('all'), [owner.id, profile?.id])
  useEffect(() => {
    if (!catalogLoading && !eventsError && !filterIsAvailable) setFilter('all')
  }, [catalogLoading, eventsError, filterIsAvailable])
  useEffect(() => setPurchaseConflict(null), [generation, owner.id])

  const busy = catalogLoading || wishlist.loading
  const conflictIsCurrent = purchaseConflict !== null
    && purchaseConflict.generation === generation
    && purchaseConflict.ownerId === owner.id
    && phase === 'ready'
  const conflictRefreshComplete = conflictIsCurrent
    && !wishlist.loading
    && wishlist.settledRefreshVersion >= purchaseConflict.refreshVersion
    && wishlist.settledRefreshVersion >= wishlist.refreshVersion
  return (
    <section ref={page} className="wishlist-page" aria-labelledby="wishlist-title">
      <div className="wishlist-intro">
        <p className="eyebrow">{owner.id === profile?.id ? 'Your list' : 'Family list'}</p>
        <h1 id="wishlist-title" data-wishlist-heading tabIndex={-1}>{owner.name}’s wishlist</h1>
      </div>
      <div className="wishlist-toolbar">
        <EventFilter events={events} value={visibleFilter} onChange={setFilter} />
        {owner.id === profile?.id && <button type="button" className="primary-button" onClick={() => setEditingItem('new')}>Add a gift</button>}
        <button type="button" className="secondary-button" onClick={wishlist.refresh} disabled={busy}>
          Refresh wishlist
        </button>
      </div>
      {visibleFilter !== 'all' && visibleFilter !== 'anything' && (
        <p className="filter-explanation">This occasion also includes gifts marked Anything.</p>
      )}
      {editingItem !== null && owner.id === profile?.id && <ItemForm
        key={editingItem === 'new' ? 'new' : editingItem.id}
        item={editingItem === 'new' ? undefined : editingItem}
        events={events}
        eventsReady={!catalogLoading && !eventsError}
        onSaved={() => { setEditingItem(null); wishlist.refresh() }}
        onCancel={() => setEditingItem(null)}
      />}
      {conflictIsCurrent && <p role="status">
        {!conflictRefreshComplete
          ? 'This gift was already purchased. Refreshing the wishlist…'
          : wishlist.error
            ? 'This gift was already purchased, but the wishlist could not be refreshed. Please retry.'
            : 'This gift was already purchased. The wishlist has been refreshed.'}
      </p>}
      {eventsError && <AsyncState loading={false} error={eventsError} onRetry={() => {
        setEventsError(null)
        setEventsLoading(true)
        setEventRetryVersion((version) => version + 1)
      }} />}
      {!eventsError && <AsyncState loading={busy} error={wishlist.error?.failure.message} onRetry={wishlist.refresh}>
        {wishlist.items.length === 0
          ? <div className="empty-state"><h2>No gifts yet</h2><p>This wishlist is empty for this selection.</p></div>
           : <div className="gift-list">{wishlist.items.map((item) => <GiftCard key={item.id} item={item}>
              {item.is_owner && <div className="owner-item-actions">
                <button type="button" className="secondary-button" onClick={() => setEditingItem(item)}>Edit gift</button>
                <button type="button" className="secondary-button" data-delete-item-id={item.id} onClick={() => setDeletingItem(item)}>Delete gift</button>
              </div>}
              {!item.is_owner && <PurchaseControls item={item} onChanged={wishlist.refresh} onConflict={() => {
               setPurchaseConflict({ generation, ownerId: owner.id, refreshVersion: wishlist.refreshVersion + 1 })
               wishlist.refresh()
             }} />}
           </GiftCard>)}</div>}
      </AsyncState>}
      {deletingItem && owner.id === profile?.id && <DeleteItemDialog item={deletingItem}
        onDeleted={() => { setDeletingItem(null); wishlist.refresh() }} onCancel={() => setDeletingItem(null)}
        getReturnFocusTarget={() => page.current?.querySelector(`[data-delete-item-id="${deletingItem.id}"]`)
          ?? page.current?.querySelector('[data-wishlist-heading]') ?? null} />}
    </section>
  )

}

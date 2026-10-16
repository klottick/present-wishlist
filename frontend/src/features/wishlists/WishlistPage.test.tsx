import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { EventOption, Item, OtherItem, OwnerItem, Profile } from '../../api/types'
import App from '../../App'
import { IdentityProvider, useIdentity } from '../identity/IdentityProvider'
import { WishlistPage } from './WishlistPage'

const api = vi.hoisted(() => ({
  clearSession: vi.fn(),
  createItem: vi.fn(),
  deleteItem: vi.fn(),
  getEvents: vi.fn(),
  getItems: vi.fn(),
  getProfiles: vi.fn(),
  getSession: vi.fn(),
  markPurchased: vi.fn(),
  selectProfile: vi.fn(),
  updateItem: vi.fn(),
}))

vi.mock('../../api/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../api/client')>(),
  ...api,
}))

const owner: Profile = { id: 1, key: 'alex', name: 'Alex' }
const sam: Profile = { id: 2, key: 'sam', name: 'Sam' }
const birthday: EventOption = { id: 1, key: 'birthday', label: 'Birthday', is_active: true }
const archived: EventOption = { id: 3, key: 'old-holiday', label: 'Old Holiday', is_active: false }
const eventNamedAll: EventOption = { id: 4, key: 'all', label: 'All Saints Day', is_active: true }

function ownerItem(overrides: Partial<OwnerItem> & Pick<OwnerItem, 'name' | 'event'>): OwnerItem {
  const { name, event, ...rest } = overrides
  return {
    id: 10,
    owner_id: 1,
    name,
    link: '',
    price: '',
    notes: '',
    event,
    allow_multiple_purchases: false,
    created_at: '2026-10-15T10:00:00Z',
    updated_at: '2026-10-15T10:00:00Z',
    is_owner: true,
    ...rest,
  }
}

function otherItem(overrides: Partial<OtherItem> & Pick<OtherItem, 'name' | 'event'>): OtherItem {
  return {
    ...ownerItem({ name: overrides.name, event: overrides.event }),
    owner_id: overrides.owner_id ?? sam.id,
    is_owner: false,
    purchases: [],
    can_purchase: true,
    can_undo: false,
    ...overrides,
  }
}

function renderWishlist(profile: Profile, profiles = [owner, sam], events = [birthday]) {
  api.getProfiles.mockResolvedValue(profiles)
  api.getSession.mockResolvedValue({ profile })
  api.getEvents.mockResolvedValue(events)
  return render(<IdentityProvider><ReadyWishlist owner={profile} /></IdentityProvider>)
}

function ReadyWishlist({ owner: wishlistOwner }: { owner: Profile }) {
  const identity = useIdentity()
  return identity.phase === 'ready' && identity.profile
    ? <WishlistPage owner={wishlistOwner} />
    : null
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('WishlistPage', () => {
  beforeEach(() => {
    api.getItems.mockResolvedValue([])
    api.getEvents.mockResolvedValue([birthday])
    api.getProfiles.mockResolvedValue([owner, sam])
    api.getSession.mockResolvedValue({ profile: owner })
    api.createItem.mockResolvedValue(ownerItem({ name: 'New gift', event: null }))
    api.updateItem.mockResolvedValue(ownerItem({ name: 'Edited gift', event: null }))
    api.deleteItem.mockResolvedValue(undefined)
  })
  afterEach(() => {
    // Pending passive effects must be unmounted before their API mocks reset.
    cleanup()
    expect(document.body).toBeEmptyDOMElement()
    vi.resetAllMocks()
  })

  it('includes Anything results in a specific event selection and says so', async () => {
    api.getItems.mockResolvedValue([
      ownerItem({ name: 'Birthday book', event: birthday }),
      ownerItem({ id: 11, name: 'Anything gift card', event: null }),
    ])
    renderWishlist(owner)

    await screen.findByText('Birthday book')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filter by occasion' }), 'event:birthday')

    expect(api.getItems).toHaveBeenLastCalledWith(owner.id, { key: 'birthday' }, expect.any(AbortSignal))
    expect(await screen.findByText('Birthday book')).toBeVisible()
    expect(screen.getByText('Anything gift card')).toBeVisible()
    expect(screen.getByText('Anything', { selector: '.gift-event-label' })).toBeVisible()
    expect(screen.getByText(/also includes gifts marked anything/i)).toBeVisible()
  })

  it('sends an event whose key is all as a specific backend event filter', async () => {
    api.getEvents.mockResolvedValue([eventNamedAll])
    api.getItems.mockResolvedValue([ownerItem({ name: 'Saints gift', event: eventNamedAll })])
    renderWishlist(owner, [owner, sam], [eventNamedAll])

    await screen.findByRole('option', { name: 'All Saints Day' })
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filter by occasion' }), 'event:all')

    expect(api.getItems).toHaveBeenLastCalledWith(owner.id, { key: 'all' }, expect.any(AbortSignal))
    expect(await screen.findByText('Saints gift')).toBeVisible()
  })

  it('ignores a late list response after the identity generation changes', async () => {
    const stale = deferred<Item[]>()
    api.getItems.mockReturnValueOnce(stale.promise).mockResolvedValueOnce([
      ownerItem({ name: 'Current generation gift', event: birthday }),
    ])
    api.getProfiles.mockResolvedValue([owner, sam])
    api.getSession.mockResolvedValue({ profile: owner })
    api.getEvents.mockResolvedValue([birthday])
    render(<IdentityProvider><ReadyWishlist owner={owner} /></IdentityProvider>)

    await screen.findByRole('combobox', { name: 'Filter by occasion' })
    // The filter exists before the asynchronous catalog enables list loading.
    // Start the stale request before focus can invalidate that generation.
    await waitFor(() => expect(api.getItems).toHaveBeenCalledTimes(1))
    await act(async () => { fireEvent.focus(window) })
    expect(await screen.findByText('Current generation gift')).toBeVisible()
    await act(async () => { stale.resolve([ownerItem({ name: 'Stale generation gift', event: birthday })]) })

    expect(screen.getByText('Current generation gift')).toBeVisible()
    expect(screen.queryByText('Stale generation gift')).not.toBeInTheDocument()
  })

  it('ignores a late list response after the event filter changes', async () => {
    const stale = deferred<Item[]>()
    api.getItems.mockReturnValueOnce(stale.promise).mockResolvedValue([
      ownerItem({ name: 'Birthday result', event: birthday }),
    ])
    renderWishlist(owner)

    await screen.findByRole('option', { name: 'Birthday' })
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filter by occasion' }), 'event:birthday')
    expect(await screen.findByText('Birthday result')).toBeVisible()
    await act(async () => { stale.resolve([ownerItem({ name: 'Stale all-events gift', event: null })]) })

    expect(screen.getByText('Birthday result')).toBeVisible()
    expect(screen.queryByText('Stale all-events gift')).not.toBeInTheDocument()
  })

  it('ignores a late request for the previous person after browsing to another family list', async () => {
    const stale = deferred<Item[]>()
    api.getProfiles.mockResolvedValue([owner, sam])
    api.getSession.mockResolvedValue({ profile: owner })
    api.getEvents.mockResolvedValue([birthday])
    api.getItems.mockReturnValueOnce(stale.promise).mockResolvedValueOnce([
      otherItem({ name: 'Sam current gift', event: birthday }),
    ])
    render(<App />)

    await screen.findByRole('heading', { name: 'Alex’s wishlist' })
    await userEvent.click(screen.getByRole('button', { name: 'Family wishlists' }))
    await userEvent.click(screen.getByRole('button', { name: 'View Sam’s wishlist' }))
    expect(await screen.findByText('Sam current gift')).toBeVisible()
    await act(async () => { stale.resolve([ownerItem({ name: 'Stale Alex gift', event: birthday })]) })

    expect(screen.getByText('Sam current gift')).toBeVisible()
    expect(screen.queryByText('Stale Alex gift')).not.toBeInTheDocument()
  })

  it('resets the occasion filter to All events when switching wishlist owners', async () => {
    api.getItems.mockResolvedValue([ownerItem({ name: 'Gift', event: birthday })])
    render(<App />)

    await screen.findByRole('heading', { name: 'Alex’s wishlist' })
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Filter by occasion' }), 'event:birthday')
    await userEvent.click(screen.getByRole('button', { name: 'Family wishlists' }))
    await userEvent.click(screen.getByRole('button', { name: 'View Sam’s wishlist' }))

    expect(await screen.findByRole('combobox', { name: 'Filter by occasion' })).toHaveValue('filter:all')
  })

  it('resets the occasion filter to All events when identity changes', async () => {
    api.getSession.mockResolvedValueOnce({ profile: owner }).mockResolvedValueOnce({ profile: sam })
    api.getItems.mockResolvedValue([ownerItem({ name: 'Gift', event: birthday })])
    render(<App />)

    await screen.findByRole('heading', { name: 'Alex’s wishlist' })
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Filter by occasion' }), 'event:birthday')
    await act(async () => { fireEvent.focus(window) })

    expect(await screen.findByRole('heading', { name: 'Sam’s wishlist' })).toBeVisible()
    expect(screen.getByRole('combobox', { name: 'Filter by occasion' })).toHaveValue('filter:all')
  })

  it('explains when the selected family profile disappears from the refreshed catalog', async () => {
    api.getProfiles.mockResolvedValueOnce([owner, sam]).mockResolvedValueOnce([owner])
    api.getSession.mockResolvedValue({ profile: owner })
    api.getItems.mockResolvedValue([otherItem({ name: 'Sam gift', event: birthday })])
    render(<App />)

    await userEvent.click(await screen.findByRole('button', { name: 'Family wishlists' }))
    await userEvent.click(screen.getByRole('button', { name: 'View Sam’s wishlist' }))
    expect(await screen.findByText('Sam gift')).toBeVisible()
    await act(async () => { fireEvent.focus(window) })

    expect(await screen.findByText(/this wishlist is no longer available/i)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Return to My wishlist' })).toBeVisible()
  })

  it('retries the event catalog through the generation-scoped request effect', async () => {
    const lateRetry = deferred<EventOption[]>()
    api.getEvents.mockRejectedValueOnce(new Error('offline')).mockReturnValueOnce(lateRetry.promise).mockResolvedValueOnce([birthday])
    renderWishlist(owner)

    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    expect(api.getEvents).toHaveBeenLastCalledWith(expect.any(AbortSignal))
    await act(async () => { fireEvent.focus(window) })
    expect(await screen.findByRole('option', { name: 'Birthday' })).toBeInTheDocument()
    await act(async () => { lateRetry.resolve([eventNamedAll]) })

    expect(screen.getByRole('option', { name: 'Birthday' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'All Saints Day' })).not.toBeInTheDocument()
  })

  it('shows only safe read-only gift details to the owner', async () => {
    api.getItems.mockResolvedValue([ownerItem({ name: 'Owner gift', event: birthday, notes: '<b>plain note</b>' })])
    renderWishlist(owner)

    expect(await screen.findByText('Owner gift')).toBeVisible()
    expect(screen.getByText('<b>plain note</b>')).toBeVisible()
    expect(screen.queryByRole('button', { name: /mark purchased/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/buyer/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit gift' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Delete gift' })).toBeVisible()
  })

  it('retains an archived event label and marks it as no longer configured', async () => {
    api.getEvents.mockResolvedValue([birthday])
    api.getItems.mockResolvedValue([ownerItem({ name: 'Old gift', event: archived })])
    renderWishlist(owner)

    expect(await screen.findByText('Old Holiday')).toBeVisible()
    expect(screen.getByText(/no longer configured/i)).toBeVisible()
  })

  it('shows a useful empty state and lets the viewer retry a failed list', async () => {
    api.getItems.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([])
    renderWishlist(owner)

    expect(await screen.findByText(/no gifts yet/i)).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Refresh wishlist' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be loaded/i)
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText(/no gifts yet/i)).toBeVisible()
  })

  it('shows buyer coordination for an other-owned item without owner item forms', async () => {
    const familyGift: Item = otherItem({
      name: 'Sam gift', event: birthday,
      purchases: [{ buyer_id: owner.id, buyer_name: 'Alex' }],
    })
    api.getItems.mockResolvedValue([familyGift])
    renderWishlist(sam)

    expect(await screen.findByText('Sam gift')).toBeVisible()
    expect(screen.getByText('Already marked by: Alex')).toBeVisible()
    expect(screen.getByRole('button', { name: /mark purchased/i })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /add gift|edit|delete/i })).not.toBeInTheDocument()
  })

  it('shows one shared repeat-purchase label on a nonowner gift card', async () => {
    api.getItems.mockResolvedValue([otherItem({
      name: 'Repeatable family gift', event: null, allow_multiple_purchases: true,
    })])
    renderWishlist(sam)

    expect(await screen.findByText('Repeatable family gift')).toBeVisible()
    expect(screen.getAllByText('This gift can be purchased by more than one person.')).toHaveLength(1)
  })

  it('keeps the purchase conflict explanation above refresh loading until refreshed items render', async () => {
    const gift = otherItem({ name: 'Sam gift', event: birthday })
    const refresh = deferred<Item[]>()
    api.getItems.mockResolvedValueOnce([gift]).mockReturnValueOnce(refresh.promise)
    api.markPurchased.mockRejectedValue(new ApiError(409, {
      code: 'already_purchased', message: 'Already purchased.',
    }))
    renderWishlist(sam)

    await userEvent.click(await screen.findByRole('button', { name: /mark purchased/i }))

    expect(await screen.findByText('This gift was already purchased. Refreshing the wishlist…')).toBeVisible()
    expect(screen.getByText('Loading…')).toBeVisible()
    expect(screen.queryByText('The wishlist has been refreshed.')).not.toBeInTheDocument()

    await act(async () => { refresh.resolve([gift]) })

    expect(await screen.findByText('Sam gift')).toBeVisible()
    expect(screen.getByText('This gift was already purchased. The wishlist has been refreshed.')).toBeVisible()
  })

  it('does not call a failed refresh successful while its retry is pending', async () => {
    const gift = otherItem({ name: 'Sam gift', event: birthday })
    const retry = deferred<Item[]>()
    api.getItems.mockResolvedValueOnce([gift]).mockRejectedValueOnce(new Error('offline')).mockReturnValueOnce(retry.promise)
    api.markPurchased.mockRejectedValue(new ApiError(409, { code: 'already_purchased', message: 'Already purchased.' }))
    renderWishlist(sam)

    await userEvent.click(await screen.findByRole('button', { name: /mark purchased/i }))
    expect(await screen.findByText('This gift was already purchased, but the wishlist could not be refreshed. Please retry.')).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('This gift was already purchased. Refreshing the wishlist…')).toBeVisible()
    expect(screen.queryByText('This gift was already purchased. The wishlist has been refreshed.')).not.toBeInTheDocument()
    await act(async () => { retry.resolve([gift]) })
    expect(await screen.findByText('This gift was already purchased. The wishlist has been refreshed.')).toBeVisible()
  })

  it('does not retain a purchase conflict explanation after an identity generation changes', async () => {
    const gift = otherItem({ name: 'Sam gift', event: birthday })
    const staleRefresh = deferred<Item[]>()
    api.getItems.mockResolvedValueOnce([]).mockResolvedValueOnce([gift]).mockReturnValueOnce(staleRefresh.promise).mockResolvedValue([])
    api.markPurchased.mockRejectedValue(new ApiError(409, { code: 'already_purchased', message: 'Already purchased.' }))
    api.getSession.mockResolvedValueOnce({ profile: owner }).mockResolvedValueOnce({ profile: sam })
    render(<App />)

    await userEvent.click(await screen.findByRole('button', { name: 'Family wishlists' }))
    await userEvent.click(screen.getByRole('button', { name: 'View Sam’s wishlist' }))
    await userEvent.click(await screen.findByRole('button', { name: /mark purchased/i }))
    expect(await screen.findByText('This gift was already purchased. Refreshing the wishlist…')).toBeVisible()

    await act(async () => { fireEvent.focus(window) })

    expect(await screen.findByRole('heading', { name: 'Sam’s wishlist' })).toBeVisible()
    expect(screen.queryByText(/this gift was already purchased/i)).not.toBeInTheDocument()
    await act(async () => { staleRefresh.resolve([gift]) })
    expect(screen.queryByText(/this gift was already purchased/i)).not.toBeInTheDocument()
  })

  it('does not retain a purchase conflict explanation when the wishlist owner changes', async () => {
    const gift = otherItem({ name: 'Sam gift', event: birthday })
    const staleRefresh = deferred<Item[]>()
    api.getSession.mockResolvedValue({ profile: owner })
    api.getItems.mockResolvedValueOnce([gift]).mockReturnValueOnce(staleRefresh.promise).mockResolvedValue([ownerItem({ name: 'Alex gift', event: birthday })])
    api.markPurchased.mockRejectedValue(new ApiError(409, { code: 'already_purchased', message: 'Already purchased.' }))
    function OwnerSwitcher() {
      const [wishlistOwner, setWishlistOwner] = useState(sam)
      return <><button type="button" onClick={() => setWishlistOwner(owner)}>Browse Alex</button><ReadyWishlist owner={wishlistOwner} /></>
    }
    render(<IdentityProvider><OwnerSwitcher /></IdentityProvider>)

    await userEvent.click(await screen.findByRole('button', { name: /mark purchased/i }))
    expect(await screen.findByText('This gift was already purchased. Refreshing the wishlist…')).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: 'Browse Alex' }))

    expect(screen.queryByText(/this gift was already purchased/i)).not.toBeInTheDocument()
    expect(await screen.findByText('Alex gift')).toBeVisible()
    await act(async () => { staleRefresh.resolve([gift]) })
    expect(screen.queryByText(/this gift was already purchased/i)).not.toBeInTheDocument()
  })

  it('keeps an unfinished owner draft through same-person focus revalidation', async () => {
    const check = deferred<{ profile: Profile }>()
    render(<StrictMode><App /></StrictMode>)
    await userEvent.click(await screen.findByRole('button', { name: /add a gift/i }))
    const name = await screen.findByRole('textbox', { name: /gift name/i })
    await userEvent.type(name, 'Keep this draft')

    api.getSession.mockReturnValueOnce(check.promise)
    await act(async () => { fireEvent.focus(window) })
    await act(async () => { check.resolve({ profile: owner }) })

    expect(await screen.findByRole('textbox', { name: /gift name/i })).toHaveValue('Keep this draft')
  })

  it('discards an unfinished owner draft when the selected identity changes', async () => {
    let serverProfile: Profile | null = owner
    api.getSession.mockImplementation(async () => ({ profile: serverProfile }))
    api.clearSession.mockImplementation(async () => {
      serverProfile = null
      return { profile: null }
    })
    api.selectProfile.mockImplementation(async (id) => {
      serverProfile = id === sam.id ? sam : owner
      return { profile: serverProfile }
    })
    render(<StrictMode><App /></StrictMode>)
    await userEvent.click(await screen.findByRole('button', { name: /add a gift/i }))
    await userEvent.type(await screen.findByRole('textbox', { name: /gift name/i }), 'Alex draft')
    await userEvent.click(screen.getByRole('button', { name: /switch name/i }))
    await userEvent.click(await screen.findByRole('button', { name: 'Sam' }))

    expect(await screen.findByRole('heading', { name: 'Sam’s wishlist' })).toBeVisible()
    expect(screen.queryByRole('textbox', { name: /gift name/i })).not.toBeInTheDocument()
    expect(api.createItem).not.toHaveBeenCalled()
  })

  it('saves and closes the owner form under StrictMode', async () => {
    api.createItem.mockResolvedValue(ownerItem({ name: 'Strict gift', event: null }))
    render(<StrictMode><App /></StrictMode>)
    await userEvent.click(await screen.findByRole('button', { name: /add a gift/i }))
    await userEvent.type(await screen.findByRole('textbox', { name: /gift name/i }), 'Strict gift')
    await userEvent.click(screen.getByRole('button', { name: /save gift/i }))

    expect(api.createItem).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByRole('textbox', { name: /gift name/i })).not.toBeInTheDocument())
  })

  it('shows server save feedback under StrictMode', async () => {
    api.createItem.mockRejectedValue(new ApiError(400, {
      code: 'validation_error', message: 'Name already exists.', fields: { name: ['Choose another gift name.'] },
    }))
    render(<StrictMode><App /></StrictMode>)
    await userEvent.click(await screen.findByRole('button', { name: /add a gift/i }))
    const name = await screen.findByRole('textbox', { name: /gift name/i })
    await userEvent.type(name, 'Duplicate')
    await userEvent.click(screen.getByRole('button', { name: /save gift/i }))

    expect(await screen.findByText('Choose another gift name.')).toBeVisible()
    expect(screen.getByRole('textbox', { name: /gift name/i })).toHaveValue('Duplicate')
  })

  it('recovers to the identity picker after an owner mutation returns identity_required', async () => {
    api.createItem.mockImplementationOnce(() => {
      api.getSession.mockResolvedValue({ profile: null })
      return Promise.reject(new ApiError(403, { code: 'identity_required', message: 'Select a person.' }))
    })
    render(<StrictMode><App /></StrictMode>)
    await userEvent.click(await screen.findByRole('button', { name: /add a gift/i }))
    await userEvent.type(await screen.findByRole('textbox', { name: /gift name/i }), 'Recovery draft')
    await userEvent.click(screen.getByRole('button', { name: /save gift/i }))

    expect(await screen.findByRole('heading', { name: 'Choose your name' })).toBeVisible()
    expect(screen.queryByRole('textbox', { name: /gift name/i })).not.toBeInTheDocument()
  })

  it('ignores a save completion from the previous identity generation', async () => {
    const staleSave = deferred<OwnerItem>()
    let serverProfile: Profile | null = owner
    api.createItem.mockReturnValue(staleSave.promise)
    api.getSession.mockImplementation(async () => ({ profile: serverProfile }))
    api.clearSession.mockImplementation(async () => {
      serverProfile = null
      return { profile: null }
    })
    api.selectProfile.mockImplementation(async () => {
      serverProfile = sam
      return { profile: sam }
    })
    render(<StrictMode><App /></StrictMode>)
    await userEvent.click(await screen.findByRole('button', { name: /add a gift/i }))
    await userEvent.type(await screen.findByRole('textbox', { name: /gift name/i }), 'Alex pending gift')
    await userEvent.click(screen.getByRole('button', { name: /save gift/i }))
    await userEvent.click(screen.getByRole('button', { name: /switch name/i }))
    await userEvent.click(await screen.findByRole('button', { name: 'Sam' }))
    expect(await screen.findByRole('heading', { name: 'Sam’s wishlist' })).toBeVisible()

    await act(async () => { staleSave.resolve(ownerItem({ name: 'Alex pending gift', event: null })) })

    expect(screen.getByRole('heading', { name: 'Sam’s wishlist' })).toBeVisible()
    expect(screen.queryByText('Alex pending gift')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /gift name/i })).not.toBeInTheDocument()
  })

  it('returns delete focus to the recreated logical trigger after focus revalidation', async () => {
    const gift = ownerItem({ name: 'Focus gift', event: null })
    const refreshed = deferred<Item[]>()
    let holdRefresh = false
    api.getItems.mockImplementation(() => holdRefresh ? refreshed.promise : Promise.resolve([gift]))
    render(<StrictMode><App /></StrictMode>)
    const trigger = await screen.findByRole('button', { name: 'Delete gift' })
    const originalTrigger = trigger
    await userEvent.click(trigger)
    expect(await screen.findByRole('dialog')).toBeVisible()
    holdRefresh = true
    const check = deferred<{ profile: Profile }>()
    api.getSession.mockReturnValueOnce(check.promise)
    await act(async () => { fireEvent.focus(window) })
    await screen.findByText('Checking your identity…')
    await act(async () => { check.resolve({ profile: owner }) })
    await act(async () => { refreshed.resolve([gift]) })
    const currentTrigger = await waitFor(() => {
      const next = document.querySelector<HTMLButtonElement>('[data-delete-item-id="10"]')
      expect(next).toBeInTheDocument()
      return next!
    })
    expect(currentTrigger).not.toBe(originalTrigger)

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(currentTrigger).toHaveFocus()
  })

  it('deletes and closes the owner confirmation under StrictMode', async () => {
    const gift = ownerItem({ name: 'Delete under strict mode', event: null })
    api.getItems.mockResolvedValue([gift])
    api.deleteItem.mockResolvedValue(undefined)
    render(<StrictMode><App /></StrictMode>)
    await userEvent.click(await screen.findByRole('button', { name: 'Delete gift' }))
    const confirm = screen.getAllByRole('button', { name: 'Delete gift' }).at(-1)!
    await userEvent.click(confirm)

    expect(api.deleteItem).toHaveBeenCalledWith(gift.id)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('returns to the identity picker when delete receives identity_required', async () => {
    const gift = ownerItem({ name: 'Identity-required delete', event: null })
    api.getItems.mockResolvedValue([gift])
    api.deleteItem.mockImplementationOnce(() => {
      api.getSession.mockResolvedValue({ profile: null })
      return Promise.reject(new ApiError(403, { code: 'identity_required', message: 'Select a person.' }))
    })
    render(<StrictMode><App /></StrictMode>)
    await userEvent.click(await screen.findByRole('button', { name: 'Delete gift' }))
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete gift' }).at(-1)!)

    expect(await screen.findByRole('heading', { name: 'Choose your name' })).toBeVisible()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('ignores a delete completion from the previous identity generation', async () => {
    const gift = ownerItem({ name: 'Stale delete gift', event: null })
    const staleDelete = deferred<void>()
    let serverProfile: Profile | null = owner
    api.getItems.mockResolvedValue([gift])
    api.deleteItem.mockReturnValue(staleDelete.promise)
    api.getSession.mockImplementation(async () => ({ profile: serverProfile }))
    api.clearSession.mockImplementation(async () => {
      serverProfile = null
      return { profile: null }
    })
    api.selectProfile.mockImplementation(async () => {
      serverProfile = sam
      return { profile: sam }
    })
    render(<StrictMode><App /></StrictMode>)
    await userEvent.click(await screen.findByRole('button', { name: 'Delete gift' }))
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete gift' }).at(-1)!)
    await userEvent.click(await screen.findByRole('button', { name: /switch name/i }))
    await userEvent.click(await screen.findByRole('button', { name: 'Sam' }))
    expect(await screen.findByRole('heading', { name: 'Sam’s wishlist' })).toBeVisible()

    await act(async () => { staleDelete.resolve(undefined) })

    expect(screen.getByRole('heading', { name: 'Sam’s wishlist' })).toBeVisible()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

})

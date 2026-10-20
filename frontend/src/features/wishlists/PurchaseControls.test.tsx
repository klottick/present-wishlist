import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { OtherItem } from '../../api/types'
import App from '../../App'
import { IdentityProvider, useIdentity } from '../identity/IdentityProvider'
import { PurchaseControls } from './PurchaseControls'

const item: OtherItem = {
  id: 9,
  owner_id: 3,
  name: 'Board game',
  link: '',
  price: '',
  notes: '',
  event: null,
  allow_multiple_purchases: true,
  created_at: '2026-10-15T10:00:00Z',
  updated_at: '2026-10-15T10:00:00Z',
  is_owner: false,
  purchases: [{ buyer_id: 1, buyer_name: 'Sam' }],
  can_purchase: true,
  can_undo: false,
}

const profile = { id: 2, key: 'robin', name: 'Robin' }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

function renderControls(onChanged = vi.fn(), onConflict = vi.fn()) {
  const fetchMock = vi.fn<typeof fetch>((input) => {
    const path = String(input)
    if (path === '/api/profiles/') return Promise.resolve(json([profile]))
    if (path === '/api/session/') return Promise.resolve(json({ profile }))
    throw new Error(`Unexpected request: ${path}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  render(<IdentityProvider><PurchaseControls item={item} onChanged={onChanged} onConflict={onConflict} /></IdentityProvider>)
  return { fetchMock, onChanged, onConflict }
}

describe('PurchaseControls', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('repeatable gift still allows another buyer', async () => {
    renderControls()

    expect(await screen.findByText('Already marked by: Sam')).toBeVisible()
    expect(screen.getByRole('button', { name: /mark purchased/i })).toBeEnabled()
  })

  it('buyer can undo only own mark', async () => {
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      if (String(input) === '/api/profiles/') return Promise.resolve(json([profile]))
      if (String(input) === '/api/session/') return Promise.resolve(json({ profile }))
      if (String(input) === '/api/items/9/purchase/' && init?.method === 'DELETE') {
        return Promise.resolve(json({ ...item, purchases: [], can_undo: false }))
      }
      throw new Error(`Unexpected request: ${String(input)}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const ownMark = { ...item, purchases: [{ buyer_id: 2, buyer_name: 'Robin' }], can_purchase: false, can_undo: true }
    render(<IdentityProvider><PurchaseControls item={ownMark} onChanged={vi.fn()} onConflict={vi.fn()} /></IdentityProvider>)

    fireEvent.click(await screen.findByRole('button', { name: /undo/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/items/9/purchase/', expect.objectContaining({ method: 'DELETE' })))
    expect(fetchMock.mock.calls.some(([path, init]) => String(path) === '/api/items/9/purchase/' && init?.method === 'PUT')).toBe(false)
  })

  it('ordinary purchased item does not offer another purchase', async () => {
    render(<IdentityProvider><PurchaseControls item={{ ...item, allow_multiple_purchases: false, can_purchase: false }} onChanged={vi.fn()} onConflict={vi.fn()} /></IdentityProvider>)

    expect(await screen.findByText('Already marked by: Sam')).toBeVisible()
    expect(screen.queryByRole('button', { name: /mark purchased/i })).not.toBeInTheDocument()
  })

  it('conflict explains that the item was already purchased and refreshes', async () => {
    const onChanged = vi.fn()
    vi.spyOn(await import('../../api/client'), 'markPurchased').mockRejectedValue(new ApiError(409, {
      code: 'already_purchased', message: 'This gift has already been purchased.',
    }))
    const onConflict = vi.fn()
    renderControls(onChanged, onConflict)

    fireEvent.click(await screen.findByRole('button', { name: /mark purchased/i }))

    await waitFor(() => expect(onConflict).toHaveBeenCalledTimes(1))
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('pending prevents double submission without optimistic success', async () => {
    const operation = deferred<OtherItem>()
    const mutation = vi.spyOn(await import('../../api/client'), 'markPurchased').mockReturnValue(operation.promise)
    renderControls()

    const button = await screen.findByRole('button', { name: /mark purchased/i })
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button)
    fireEvent.click(button)

    expect(button).toBeDisabled()
    expect(screen.queryByText(/you marked this/i)).not.toBeInTheDocument()
    expect(mutation).toHaveBeenCalledTimes(1)
    await act(async () => { operation.resolve({ ...item, can_purchase: false, can_undo: true }) })
  })

  it('failure explains retry without claiming success', async () => {
    vi.spyOn(await import('../../api/client'), 'markPurchased').mockRejectedValue(new Error('offline'))
    renderControls()

    const button = await screen.findByRole('button', { name: /mark purchased/i })
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button)

    expect(await screen.findByText('We could not update this purchase. Please try again.')).toBeVisible()
    expect(screen.queryByText(/you marked this/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /mark purchased/i })).toBeEnabled()
  })

  it('identity transition discards pending purchase completion', async () => {
    const operation = deferred<OtherItem>()
    vi.spyOn(await import('../../api/client'), 'markPurchased').mockReturnValue(operation.promise)
    const onChanged = vi.fn()
    const nextProfile = { id: 4, key: 'lee', name: 'Lee' }
    let serverProfile = profile
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      const path = String(input)
      if (path === '/api/profiles/') return Promise.resolve(json([profile, nextProfile]))
      if (path === '/api/session/' && init?.method === 'PUT') {
        serverProfile = nextProfile
        return Promise.resolve(json({ profile: serverProfile }))
      }
      if (path === '/api/session/') return Promise.resolve(json({ profile: serverProfile }))
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    function SwitchableControls() {
      const identity = useIdentity()
      return <><button type="button" onClick={() => void identity.choose(nextProfile.id)}>Switch identity</button>
        <p>{identity.profile?.name}</p><PurchaseControls item={item} onChanged={onChanged} onConflict={vi.fn()} /></>
    }
    render(<IdentityProvider><SwitchableControls /></IdentityProvider>)
    fireEvent.click(await screen.findByRole('button', { name: /mark purchased/i }))

    fireEvent.click(screen.getByRole('button', { name: 'Switch identity' }))
    expect(await screen.findByText('Lee')).toBeVisible()
    await act(async () => { operation.resolve({ ...item, can_purchase: false, can_undo: true }) })

    expect(screen.queryByText(/you marked this/i)).not.toBeInTheDocument()
    expect(onChanged).not.toHaveBeenCalled()
    expect(fetchMock.mock.calls.some(([path, init]) => String(path) === '/api/session/' && init?.method === 'PUT')).toBe(true)
  })

  it('same-identity revalidation clears an obsolete pending state', async () => {
    const operation = deferred<OtherItem>()
    vi.spyOn(await import('../../api/client'), 'markPurchased').mockReturnValue(operation.promise)
    renderControls()
    fireEvent.click(await screen.findByRole('button', { name: /mark purchased/i }))

    await act(async () => { window.dispatchEvent(new Event('focus')) })

    await waitFor(() => expect(screen.getByRole('button', { name: /mark purchased/i })).toBeEnabled())
    expect(screen.queryByText('Updating purchase…')).not.toBeInTheDocument()
    await act(async () => { operation.resolve({ ...item, can_purchase: false, can_undo: true }) })
  })

  it('revalidates identity after the real purchase request returns identity_required', async () => {
    let sessionReads = 0
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      const path = String(input)
      if (path === '/api/config/') return Promise.resolve(json({ family_name: null }))
      if (path === '/api/profiles/') return Promise.resolve(json([profile, { id: 3, key: 'alex', name: 'Alex' }]))
      if (path === '/api/session/') {
        sessionReads += 1
        return Promise.resolve(json({ profile: sessionReads === 1 ? profile : null }))
      }
      if (path === '/api/events/') return Promise.resolve(json([]))
      if (path === '/api/profiles/2/items/') return Promise.resolve(json([item]))
      if (path === '/api/items/9/purchase/' && init?.method === 'PUT') {
        return Promise.resolve(json({ code: 'identity_required', message: 'Select a person.' }, 403))
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: /mark purchased/i }))

    expect(await screen.findByRole('heading', { name: /choose your name/i })).toBeVisible()
    expect(fetchMock.mock.calls.some(([path, init]) => String(path) === '/api/items/9/purchase/' && init?.method === 'PUT')).toBe(true)
    expect(sessionReads).toBe(2)
  })

  it('503 response leaves the buyer able to retry', async () => {
    const onChanged = vi.fn()
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      const path = String(input)
      if (path === '/api/profiles/') return Promise.resolve(json([profile]))
      if (path === '/api/session/') return Promise.resolve(json({ profile }))
      if (path === '/api/items/9/purchase/' && init?.method === 'PUT') {
        return Promise.resolve(json({ code: 'database_busy', message: 'Try again.' }, 503))
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<IdentityProvider><PurchaseControls item={item} onChanged={onChanged} onConflict={vi.fn()} /></IdentityProvider>)

    fireEvent.click(await screen.findByRole('button', { name: /mark purchased/i }))

    expect(await screen.findByText('We could not update this purchase. Please try again.')).toBeVisible()
    expect(screen.getByRole('button', { name: /mark purchased/i })).toBeEnabled()
    expect(onChanged).not.toHaveBeenCalled()
    expect(fetchMock.mock.calls.some(([path, init]) => String(path) === '/api/items/9/purchase/' && init?.method === 'PUT')).toBe(true)
  })
})

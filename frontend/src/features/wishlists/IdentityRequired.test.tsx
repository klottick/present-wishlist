import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'

const profile = { id: 2, key: 'sam', name: 'Sam' }
const profiles = [profile, { id: 1, key: 'alex', name: 'Alex' }]
const event = { id: 1, key: 'birthday', label: 'Birthday', is_active: true }
const familyItem = {
  id: 44,
  owner_id: 2,
  name: 'Read-only gift',
  link: '',
  price: '',
  notes: '',
  event,
  allow_multiple_purchases: false,
  created_at: '2026-10-15T10:00:00Z',
  updated_at: '2026-10-15T10:00:00Z',
  is_owner: false,
  purchases: [{ buyer_id: 1, buyer_name: 'Secret buyer' }],
  can_purchase: true,
  can_undo: false,
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('list identity failure integration', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('revalidates the session after the actual getItems request fails and clears private list content', async () => {
    let sessionReads = 0
    let itemReads = 0
    const sessionConfirmation = deferred<Response>()
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const path = String(input)
      if (path === '/api/profiles/') return json(profiles)
      if (path === '/api/session/') {
        sessionReads += 1
        return sessionReads === 1 ? json({ profile }) : sessionConfirmation.promise
      }
      if (path === '/api/events/') return json([event])
      if (path === '/api/profiles/2/items/') {
        itemReads += 1
        return itemReads === 1
          ? json([familyItem])
          : json({ code: 'identity_required', message: 'Select a person.' }, 403)
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)

    expect(await screen.findByText('Read-only gift')).toBeVisible()
    expect(screen.queryByText('Secret buyer')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh wishlist' }))

    await waitFor(() => expect(screen.getByText('Checking your identity…')).toBeVisible())
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(itemReads).toBe(2)
    expect(sessionReads).toBe(2)
    await act(async () => { sessionConfirmation.resolve(json({ profile: null })) })
    expect(await screen.findByRole('heading', { name: /choose your name/i })).toBeVisible()
    await waitFor(() => expect(sessionReads).toBe(2))
    expect(fetchMock.mock.calls.some(([path]) => path === '/api/profiles/2/items/')).toBe(true)
    expect(itemReads).toBe(2)
    expect(screen.queryByText('Read-only gift')).not.toBeInTheDocument()
    expect(screen.queryByText('Secret buyer')).not.toBeInTheDocument()
  })
})

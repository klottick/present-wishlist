import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  createItem,
  deleteItem,
  getEvents,
  getItems,
  getProfiles,
  getSession,
  markPurchased,
  request,
  selectProfile,
  undoPurchase,
  updateItem,
  clearSession,
} from './client'
import { ownerItemFixture, sessionFixture } from '../test/fixtures'

const fetchMock = vi.fn<typeof fetch>()

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('typed API client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    document.cookie = 'csrftoken=test-token; path=/'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    document.cookie = 'csrftoken=; Max-Age=0; path=/'
  })

  it('sends CSRF and session cookies for mutations', async () => {
    fetchMock.mockResolvedValue(jsonResponse(sessionFixture))

    await selectProfile(1)

    expect(fetchMock).toHaveBeenCalledWith('/api/session/', expect.objectContaining({
      method: 'PUT',
      credentials: 'same-origin',
    }))
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(headers.get('X-CSRFToken')).toBe('test-token')
  })

  it('does not parse a 204 body', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await expect(deleteItem(7)).resolves.toBeUndefined()
  })

  it('maps field errors and non-JSON failures to ApiError', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      code: 'validation_error',
      message: 'Invalid item.',
      fields: { name: ['This field is required.'] },
    }, 400))
    await expect(createItem({ ...itemInput, name: '' })).rejects.toMatchObject({
      status: 400,
      failure: {
        code: 'validation_error',
        message: 'Invalid item.',
        fields: { name: ['This field is required.'] },
      },
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/items/', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ ...itemInput, name: '' }),
    }))

    fetchMock.mockResolvedValueOnce(new Response('upstream unavailable', {
      status: 502,
      headers: { 'Content-Type': 'text/plain' },
    }))
    await expect(request('/api/session/')).rejects.toMatchObject({
      status: 502,
      failure: { code: 'request_error', message: 'upstream unavailable' },
    })
  })

  it('discards malformed optional fields from API failures', async () => {
    const malformedFields = [
      { name: 'must be an array' },
      { name: ['a message', 3] },
      ['must be a keyed object'],
      null,
    ]

    for (const fields of malformedFields) {
      fetchMock.mockResolvedValueOnce(jsonResponse({
        code: 'validation_error',
        message: 'Invalid item.',
        fields,
      }, 400))
      const rejection = await request('/api/items/').catch((error: unknown) => error)

      expect(rejection).toBeInstanceOf(ApiError)
      expect((rejection as ApiError).failure).toEqual({
        code: 'request_error',
        message: expect.any(String),
      })
    }
  })

  it('preserves abort cancellation', async () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError')
    fetchMock.mockRejectedValue(abortError)
    const controller = new AbortController()

    await expect(getSession(controller.signal)).rejects.toBe(abortError)
  })

  it('omits all-events query but encodes specific event keys including all', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse([])))

    await getItems(5, 'all')
    await getItems(5, { key: 'winter party/a&b' })
    await getItems(5, { key: 'all' })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/profiles/5/items/')
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      '/api/profiles/5/items/?event=winter+party%2Fa%26b',
    )
    expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/profiles/5/items/?event=all')
  })

  it('uses the documented endpoints and payloads for the remaining API operations', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(sessionFixture)))
    await getProfiles()
      await getEvents()
      await clearSession()
      await request('/api/session/')
      fetchMock.mockResolvedValueOnce(jsonResponse(ownerItemFixture, 201))
      const created = await createItem(itemInput)
      expect(created).toEqual(ownerItemFixture)
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(ownerItemFixture)))
    await updateItem(8, { notes: 'For later' })
    await markPurchased(8)
    await undoPurchase(8)

    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ['/api/profiles/', undefined],
      ['/api/events/', undefined],
      ['/api/session/', 'DELETE'],
      ['/api/session/', undefined],
      ['/api/items/', 'POST'],
      ['/api/items/8/', 'PATCH'],
      ['/api/items/8/purchase/', 'PUT'],
      ['/api/items/8/purchase/', 'DELETE'],
    ])
    expect(fetchMock.mock.calls[4]?.[1]?.body).toBe(JSON.stringify(itemInput))
    expect(fetchMock.mock.calls[5]?.[1]?.body).toBe(JSON.stringify({ notes: 'For later' }))
  })

  it('exposes HTTP failures as ApiError instances', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 'forbidden', message: 'Denied.' }, 403))

    const failure = await request('/api/session/').catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ApiError)
    expect(failure).toMatchObject({ status: 403, failure: { code: 'forbidden' } })
  })
})

const itemInput = {
  name: 'Book',
  link: '',
  price: '',
  notes: '',
  event_id: null,
  allow_multiple_purchases: false,
}

import type {
  ApiFailure,
  EventFilterValue,
  EventOption,
  Item,
  ItemInput,
  OtherItem,
  OwnerItem,
  Profile,
  Session,
} from './types'

export class ApiError extends Error {
  readonly status: number
  readonly failure: ApiFailure

  constructor(status: number, failure: ApiFailure) {
    super(failure.message)
    this.name = 'ApiError'
    this.status = status
    this.failure = failure
  }
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase()
  const headers = new Headers(init.headers)
  const unsafe = !['GET', 'HEAD', 'OPTIONS', 'TRACE'].includes(method)

  if (unsafe) {
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    const csrfToken = readCookie('csrftoken')
    if (csrfToken) headers.set('X-CSRFToken', csrfToken)
  }

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: 'same-origin',
  })

  if (response.status === 204) return undefined as T

  const body = await response.text()
  let data: unknown
  try {
    data = body ? JSON.parse(body) as unknown : undefined
  } catch {
    data = undefined
  }

  if (!response.ok) {
    throw new ApiError(response.status, normalizeFailure(data, body, response.statusText))
  }

  if (data === undefined) {
    throw new ApiError(response.status, {
      code: 'invalid_response',
      message: body.trim() || 'The server returned an invalid response.',
    })
  }
  return data as T
}

export function getSession(signal?: AbortSignal): Promise<Session> {
  return request('/api/session/', { signal })
}

export function selectProfile(id: number): Promise<Session> {
  return request('/api/session/', {
    method: 'PUT',
    body: JSON.stringify({ profile_id: id }),
  })
}

export function clearSession(): Promise<Session> {
  return request('/api/session/', { method: 'DELETE' })
}

export function getProfiles(signal?: AbortSignal): Promise<Profile[]> {
  return request('/api/profiles/', { signal })
}

export function getEvents(signal?: AbortSignal): Promise<EventOption[]> {
  return request('/api/events/', { signal })
}

export function getItems(
  profileId: number,
  filter: EventFilterValue,
  signal?: AbortSignal,
): Promise<Item[]> {
  const query = new URLSearchParams()
  if (filter === 'anything') query.set('event', 'anything')
  else if (typeof filter === 'object') query.set('event', filter.key)
  const suffix = query.size ? `?${query.toString()}` : ''
  return request(`/api/profiles/${profileId}/items/${suffix}`, { signal })
}

export function createItem(input: ItemInput): Promise<OwnerItem> {
  return request('/api/items/', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateItem(id: number, input: Partial<ItemInput>): Promise<OwnerItem> {
  return request(`/api/items/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function deleteItem(id: number): Promise<void> {
  return request(`/api/items/${id}/`, { method: 'DELETE' })
}

export function markPurchased(id: number): Promise<OtherItem> {
  return request(`/api/items/${id}/purchase/`, { method: 'PUT' })
}

export function undoPurchase(id: number): Promise<OtherItem> {
  return request(`/api/items/${id}/purchase/`, { method: 'DELETE' })
}

function readCookie(name: string): string | undefined {
  const prefix = `${name}=`
  const cookie = document.cookie.split('; ').find((entry) => entry.startsWith(prefix))
  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : undefined
}

function normalizeFailure(data: unknown, body: string, statusText: string): ApiFailure {
  if (isApiFailure(data)) return data
  const readableBody = body.trim()
  return {
    code: 'request_error',
    message: readableBody || statusText || 'The request could not be completed.',
  }
}

function isApiFailure(value: unknown): value is ApiFailure {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.code !== 'string' || typeof candidate.message !== 'string') return false
  if (!('fields' in candidate)) return true
  if (typeof candidate.fields !== 'object' || candidate.fields === null || Array.isArray(candidate.fields)) {
    return false
  }
  return Object.values(candidate.fields).every(
    (messages) => Array.isArray(messages) && messages.every((message) => typeof message === 'string'),
  )
}

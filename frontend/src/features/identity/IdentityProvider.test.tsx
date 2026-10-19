import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { Profile, Session } from '../../api/types'
import App from '../../App'
import { IdentityProvider, useIdentity } from './IdentityProvider'
import { NamePicker } from './NamePicker'

const api = vi.hoisted(() => ({
  clearSession: vi.fn<() => Promise<Session>>(),
  getEvents: vi.fn(),
  getItems: vi.fn(),
  getProfiles: vi.fn<() => Promise<Profile[]>>(),
  getSession: vi.fn<() => Promise<Session>>(),
  selectProfile: vi.fn<(id: number) => Promise<Session>>(),
}))

vi.mock('../../api/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../api/client')>(),
  ...api,
}))

const sam: Profile = { id: 1, key: 'sam', name: 'Sam' }
const alex: Profile = { id: 2, key: 'alex', name: 'Alex' }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function session(profile: Profile | null): Session {
  return { profile }
}

function IdentityProbe() {
  const { profile, phase, choose, revalidate, profiles, error } = useIdentity()
  return (
    <>
      <p>{profile?.name ?? 'No person'}: {phase}</p>
      <div hidden={phase !== 'ready'} inert={phase !== 'ready'}>
        {profile && <DraftEditor key={profile.id} />}
      </div>
      <button onClick={() => void choose(alex.id)}>Alex</button>
      <button onClick={() => void choose(sam.id)}>Sam</button>
      <button onClick={() => void revalidate()}>Check identity</button>
      {phase === 'error' && <><p role="alert">{error}</p><button onClick={() => void revalidate()}>Retry</button></>}
      {!profile && phase === 'ready' && <NamePicker profiles={profiles} pending={false} onChoose={choose} />}
    </>
  )
}

function DraftEditor() {
  const [text, setText] = React.useState('')
  return <label>Private note <input value={text} onChange={(event) => setText(event.target.value)} /></label>
}

function renderIdentity() {
  return render(<IdentityProvider><IdentityProbe /></IdentityProvider>)
}

describe('identity lifecycle', () => {
  beforeEach(() => {
    api.getEvents.mockResolvedValue([])
    api.getItems.mockResolvedValue([])
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('shows configured names without an add-member control', async () => {
    api.getProfiles.mockResolvedValue([sam, alex])
    api.getSession.mockResolvedValue(session(null))
    render(<IdentityProvider><NamePicker profiles={[sam, alex]} pending={false} onChoose={() => undefined} /></IdentityProvider>)

    expect(await screen.findByRole('button', { name: 'Alex' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /add family member/i })).not.toBeInTheDocument()
  })

  it('explains how to configure an empty family catalog', async () => {
    api.getProfiles.mockResolvedValue([])
    api.getSession.mockResolvedValue(session(null))
    render(<App />)

    expect(await screen.findByText('backend/config/family.yaml')).toBeVisible()
    expect(screen.getByText(/restart the backend/i)).toBeVisible()
  })

  it('keeps the bootstrap gate closed until the configured profile catalog arrives', async () => {
    const catalog = deferred<Profile[]>()
    const initialSession = deferred<Session>()
    api.getProfiles.mockReturnValueOnce(catalog.promise)
    api.getSession.mockReturnValueOnce(initialSession.promise)
    render(<App />)

    await act(async () => { initialSession.resolve(session(null)); await initialSession.promise })
    expect(screen.queryByText('backend/config/family.yaml')).not.toBeInTheDocument()
    await act(async () => { catalog.resolve([sam]); await catalog.promise })

    expect(await screen.findByRole('button', { name: 'Sam' })).toBeVisible()
  })

  it('ignores late bootstrap catalog success after focus revalidation succeeds', async () => {
    const staleCatalog = deferred<Profile[]>()
    api.getProfiles.mockReturnValueOnce(staleCatalog.promise).mockResolvedValueOnce([sam, alex])
    api.getSession.mockResolvedValue(session(null))
    render(<App />)
    expect(await screen.findByRole('status')).toBeVisible()

    await act(async () => { fireEvent.focus(window) })
    expect(await screen.findByRole('button', { name: 'Alex' })).toBeVisible()
    await act(async () => { staleCatalog.resolve([]); await staleCatalog.promise })

    expect(screen.getByRole('button', { name: 'Alex' })).toBeVisible()
    expect(screen.queryByText('backend/config/family.yaml')).not.toBeInTheDocument()
  })

  it('ignores late bootstrap catalog failure after focus revalidation succeeds', async () => {
    const staleCatalog = deferred<Profile[]>()
    api.getProfiles.mockReturnValueOnce(staleCatalog.promise).mockResolvedValueOnce([sam, alex])
    api.getSession.mockResolvedValue(session(null))
    render(<App />)
    expect(await screen.findByRole('status')).toBeVisible()

    await act(async () => { fireEvent.focus(window) })
    expect(await screen.findByRole('button', { name: 'Alex' })).toBeVisible()
    await act(async () => { staleCatalog.reject(new Error('late bootstrap failure')); await staleCatalog.promise.catch(() => undefined) })

    expect(screen.getByRole('button', { name: 'Alex' })).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('serializes selections and defers focus checks until server mutations settle', async () => {
    const alexSelection = deferred<Session>()
    const samSelection = deferred<Session>()
    let serverProfile: Profile | null = sam
    api.getProfiles.mockResolvedValue([sam, alex])
    api.getSession.mockImplementation(async () => session(serverProfile))
    api.selectProfile.mockImplementation((id) => id === alex.id ? alexSelection.promise : samSelection.promise)
    renderIdentity()
    expect(await screen.findByText('Sam: ready')).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: 'Alex' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sam' }))
    expect(api.selectProfile.mock.calls.map(([id]) => id)).toEqual([alex.id])
    expect(screen.getByText('No person: changing')).toBeVisible()

    await act(async () => { fireEvent.focus(window) })
    expect(api.getSession).toHaveBeenCalledOnce()

    await act(async () => {
      serverProfile = alex
      alexSelection.resolve(session(alex))
      await alexSelection.promise
    })
    await waitFor(() => expect(api.selectProfile.mock.calls.map(([id]) => id)).toEqual([alex.id, sam.id]))
    expect(screen.getByText('No person: changing')).toBeVisible()

    await act(async () => {
      serverProfile = sam
      samSelection.resolve(session(sam))
      await samSelection.promise
    })

    expect(await screen.findByText('Sam: ready')).toBeVisible()
    expect(api.getSession).toHaveBeenCalledTimes(2)
  })

  it('preserves an unsaved input when a focus check confirms the same identity', async () => {
    api.getProfiles.mockResolvedValue([sam, alex])
    api.getSession.mockResolvedValue(session(sam))
    renderIdentity()
    const input = await screen.findByRole('textbox', { name: 'Private note' })
    await userEvent.type(input, 'secret draft')

    await act(async () => { fireEvent.focus(window) })

    expect(await screen.findByDisplayValue('secret draft')).toBeInTheDocument()
    expect(screen.getByText('Sam: ready')).toBeVisible()
  })

  it('clears the old draft after a shared-tab identity change', async () => {
    api.getProfiles.mockResolvedValue([sam, alex])
    api.getSession.mockResolvedValueOnce(session(sam)).mockResolvedValueOnce(session(alex))
    renderIdentity()
    const input = await screen.findByRole('textbox', { name: 'Private note' })
    await userEvent.type(input, 'private to Sam')
    await act(async () => { fireEvent.focus(window) })

    expect(await screen.findByText('Alex: ready')).toBeVisible()
    expect(screen.queryByDisplayValue('private to Sam')).not.toBeInTheDocument()
  })

  it('keeps authenticated content visible through blur and revalidates on focus', async () => {
    const focusCheck = deferred<Session>()
    api.getProfiles.mockResolvedValue([sam, alex])
    api.getSession.mockResolvedValueOnce(session(sam)).mockReturnValueOnce(focusCheck.promise)
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Sam’s wishlist' })).toBeVisible()

    await act(async () => { fireEvent.blur(window) })

    expect(screen.getByRole('heading', { name: 'Sam’s wishlist' })).toBeVisible()
    expect(screen.queryByText('Checking your identity')).not.toBeInTheDocument()
    await act(async () => { fireEvent.focus(window); focusCheck.resolve(session(sam)); await focusCheck.promise })

    expect(await screen.findByRole('heading', { name: 'Sam’s wishlist' })).toBeVisible()
  })

  it('keeps old identity content hidden and offers retry after selection failure', async () => {
    let serverProfile: Profile | null = sam
    api.getProfiles.mockResolvedValue([sam, alex])
    api.getSession.mockImplementation(async () => session(serverProfile))
    api.selectProfile.mockRejectedValue(new Error('offline'))
    api.clearSession.mockImplementation(async () => {
      serverProfile = null
      return session(null)
    })
    render(<App />)
    expect(await screen.findByText(/Viewing as/)).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: 'Switch name' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Alex' }))

    expect(await screen.findByText(/could not check.*identity/i)).toBeVisible()
    expect(screen.queryByText('Viewing as Sam')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeEnabled()
  })

  it('returns to the picker when the API reports identity required', async () => {
    api.getProfiles.mockResolvedValue([sam, alex])
    api.getSession.mockResolvedValueOnce(session(sam)).mockRejectedValueOnce(new ApiError(403, {
      code: 'identity_required', message: 'Select a person.',
    }))
    render(<App />)
    expect(await screen.findByText(/Viewing as/)).toBeVisible()
    await act(async () => { fireEvent.focus(window) })

    expect(await screen.findByText(/choose your name/i)).toBeVisible()
    expect(screen.queryByText('Viewing as Sam')).not.toBeInTheDocument()
  })

  it('restores the server-selected person after the root is remounted', async () => {
    api.getProfiles.mockResolvedValue([sam, alex])
    api.getSession.mockResolvedValue(session(alex))
    const first = renderIdentity()
    expect(await screen.findByText('Alex: ready')).toBeVisible()
    first.unmount()

    renderIdentity()

    expect(await screen.findByText('Alex: ready')).toBeVisible()
  })
})

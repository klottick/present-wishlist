import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { IdentityProvider, useIdentity } from './IdentityProvider'
import { ProfilePhotoEditor } from './ProfilePhotoEditor'
import type { Profile } from '../../api/types'

const api = vi.hoisted(() => ({ getProfiles: vi.fn(), getSession: vi.fn(), uploadAvatar: vi.fn(), removeAvatar: vi.fn(), selectProfile: vi.fn() }))
vi.mock('../../api/client', async (original) => ({ ...await original<typeof import('../../api/client')>(), ...api }))
const owner = { id: 1, key: 'alex', name: 'Alex', avatar_url: null }
const photo = { ...owner, avatar_url: '/api/profiles/1/avatar/?v=updated' }
function Probe() {
  const identity = useIdentity()
  return identity.phase === 'ready' ? <><output aria-label="Saved photo">{identity.profile?.avatar_url ?? 'None'}</output><button onClick={() => void identity.choose(2)}>Choose Sam</button><ProfilePhotoEditor /></> : null
}
function start() { return render(<IdentityProvider><Probe /></IdentityProvider>) }
beforeEach(() => {
  api.getProfiles.mockResolvedValue([owner, { id: 2, key: 'sam', name: 'Sam', avatar_url: null }])
  api.getSession.mockResolvedValue({ profile: owner })
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:selected'), revokeObjectURL: vi.fn() }))
})
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals() })

it('uploads and removes a photo and updates saved identity without a reload', async () => {
  api.uploadAvatar.mockResolvedValue(photo)
  api.removeAvatar.mockResolvedValue(owner)
  start()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Profile photo' }))
  await user.upload(screen.getByLabelText('Choose a photo'), new File(['image'], 'photo.png', { type: 'image/png' }))
  await user.click(screen.getByRole('button', { name: 'Save photo' }))
  expect(await screen.findByLabelText('Saved photo')).toHaveTextContent(photo.avatar_url)
  await user.click(screen.getByRole('button', { name: 'Profile photo' }))
  await user.click(screen.getByRole('button', { name: 'Remove photo' }))
  expect(await screen.findByLabelText('Saved photo')).toHaveTextContent('None')
})

it('retains the saved photo and chosen input when upload fails', async () => {
  api.getSession.mockResolvedValue({ profile: photo })
  api.uploadAvatar.mockRejectedValue(new Error('Offline'))
  start()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Profile photo' }))
  await user.upload(screen.getByLabelText('Choose a photo'), new File(['image'], 'photo.png', { type: 'image/png' }))
  await user.click(screen.getByRole('button', { name: 'Save photo' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/could not.*photo/i)
  expect(screen.getByLabelText('Saved photo')).toHaveTextContent(photo.avatar_url)
  expect(screen.getByRole('button', { name: 'Save photo' })).toBeEnabled()
})

it('does not apply a late photo response after switching profiles', async () => {
  let resolve!: (profile: Profile) => void
  api.uploadAvatar.mockImplementation(() => new Promise((done) => { resolve = done }))
  start()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Profile photo' }))
  await user.upload(screen.getByLabelText('Choose a photo'), new File(['image'], 'photo.png', { type: 'image/png' }))
  await user.click(screen.getByRole('button', { name: 'Save photo' }))
  api.getSession.mockResolvedValue({ profile: { id: 2, key: 'sam', name: 'Sam', avatar_url: null } })
  api.selectProfile.mockResolvedValue({ profile: { id: 2, key: 'sam', name: 'Sam' } })
  await user.click(screen.getByRole('button', { name: 'Choose Sam' }))
  await act(async () => { resolve(photo) })
  expect(await screen.findByLabelText('Saved photo')).toHaveTextContent('None')
})

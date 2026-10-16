import { act, render, screen, waitFor } from '@testing-library/react'
import { StrictMode, useState } from 'react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import { DeleteItemDialog } from './DeleteItemDialog'
import { IdentityProvider, useIdentity } from '../identity/IdentityProvider'
import type { OwnerItem } from '../../api/types'
import type { ReactNode } from 'react'

const api = vi.hoisted(() => ({ deleteItem: vi.fn(), getProfiles: vi.fn(), getSession: vi.fn() }))
vi.mock('../../api/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../api/client')>(),
  ...api,
}))

const item: OwnerItem = {
  id: 5, owner_id: 1, name: 'Travel mug', link: '', price: '', notes: '', event: null,
  allow_multiple_purchases: false, created_at: '2026-10-15T10:00:00Z', updated_at: '2026-10-15T10:00:00Z', is_owner: true,
}
const profile = { id: 1, key: 'alex', name: 'Alex' }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function renderDialog() {
  api.getProfiles.mockResolvedValue([profile])
  api.getSession.mockResolvedValue({ profile })
  const onDeleted = vi.fn()
  const onCancel = vi.fn()
  render(<StrictMode><IdentityProvider><button type="button">Open delete</button><DeleteItemDialog item={item} onDeleted={onDeleted} onCancel={onCancel} /></IdentityProvider></StrictMode>)
  return { onDeleted, onCancel }
}

function DialogHarness({ onCancel }: { onCancel: () => void }) {
  const [open, setOpen] = useState(false)
  return <><button type="button" onClick={() => setOpen(true)}>Open delete</button>
    {open && <DeleteItemDialog item={item} onDeleted={() => setOpen(false)} onCancel={() => { setOpen(false); onCancel() }} />}</>
}

function IdentityVisibilityBoundary({ children }: { children: ReactNode }) {
  const { phase } = useIdentity()
  const checking = phase === 'checking' || phase === 'changing'
  return <div hidden={checking} inert={checking}>{children}</div>
}

describe('DeleteItemDialog', () => {
  afterEach(() => vi.resetAllMocks())

  it('uses purchase-independent confirmation and returns focus when cancelled with Escape', async () => {
    const profile = { id: 1, key: 'alex', name: 'Alex' }
    api.getProfiles.mockResolvedValue([profile])
    api.getSession.mockResolvedValue({ profile })
    const onCancel = vi.fn()
    render(<StrictMode><IdentityProvider><DialogHarness onCancel={onCancel} /></IdentityProvider></StrictMode>)
    const user = userEvent.setup()
    const opener = screen.getByRole('button', { name: 'Open delete' })
    await user.click(opener)
    const cancel = await screen.findByRole('button', { name: 'Cancel' })
    expect(screen.getByRole('dialog')).toHaveTextContent('Delete “Travel mug” from this wishlist?')
    expect(cancel).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledOnce()
    expect(opener).toHaveFocus()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('contains keyboard focus and confirms deletion with Enter', async () => {
    api.deleteItem.mockResolvedValue(undefined)
    const { onDeleted } = renderDialog()
    const user = userEvent.setup()
    const cancel = await screen.findByRole('button', { name: 'Cancel' })
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Delete gift' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(api.deleteItem).toHaveBeenCalledWith(item.id)
    expect(onDeleted).toHaveBeenCalledOnce()
    expect(cancel).toBeInTheDocument()
  })

  it('keeps Tab and Shift+Tab in the dialog while deletion is pending', async () => {
    const deletion = deferred<void>()
    api.deleteItem.mockReturnValue(deletion.promise)
    const { onDeleted } = renderDialog()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Delete gift' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await user.tab()
    expect(dialog).toHaveFocus()
    await user.tab({ shift: true })
    expect(dialog).toHaveFocus()
    await act(async () => { deletion.resolve(undefined) })
    expect(onDeleted).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Delete gift' })).toBeEnabled()
  })

  it('contains Shift+Tab after a failed deletion returns focus to the dialog container', async () => {
    api.deleteItem.mockRejectedValue(new Error('network unavailable'))
    renderDialog()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Delete gift' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The gift could not be deleted. Please try again.')
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveFocus()

    await user.tab({ shift: true })

    expect(dialog).toContainElement(document.activeElement as HTMLElement)
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Delete gift' })).toHaveFocus()
  })

  it('keeps focus inside the dialog after same-profile identity revalidation', async () => {
    api.deleteItem.mockRejectedValue(new ApiError(403, { code: 'identity_required', message: 'Select your name again.' }))
    api.getProfiles.mockResolvedValue([profile])
    api.getSession.mockResolvedValue({ profile })
    render(<IdentityProvider><IdentityVisibilityBoundary>
      <DeleteItemDialog item={item} onDeleted={vi.fn()} onCancel={vi.fn()} />
    </IdentityVisibilityBoundary></IdentityProvider>)
    const user = userEvent.setup()
    await screen.findByRole('button', { name: 'Cancel' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete gift' })).toBeEnabled())

    await user.click(screen.getByRole('button', { name: 'Delete gift' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeVisible()
    await waitFor(() => expect(dialog).toHaveFocus())
  })
})

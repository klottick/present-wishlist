import { render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import { ItemForm } from './ItemForm'
import { IdentityProvider } from '../identity/IdentityProvider'

const api = vi.hoisted(() => ({ createItem: vi.fn(), updateItem: vi.fn(), getProfiles: vi.fn(), getSession: vi.fn() }))
vi.mock('../../api/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../api/client')>(),
  ...api,
}))

const birthday = { id: 1, key: 'birthday', label: 'Birthday', is_active: true }
const archived = { id: 3, key: 'old-event', label: 'Old Event', is_active: false }
const item = {
  id: 4, owner_id: 1, name: 'Old gift', link: '', price: '', notes: '', event: archived,
  allow_multiple_purchases: false, created_at: '2026-10-15T10:00:00Z', updated_at: '2026-10-15T10:00:00Z', is_owner: true as const,
}

function renderForm(props: React.ComponentProps<typeof ItemForm>) {
  const profile = { id: 1, key: 'alex', name: 'Alex' }
  api.getProfiles.mockResolvedValue([profile])
  api.getSession.mockResolvedValue({ profile })
  return render(<StrictMode><IdentityProvider><ItemForm {...props} /></IdentityProvider></StrictMode>)
}

describe('ItemForm', () => {
  afterEach(() => vi.resetAllMocks())

  it('defaults new items to Anything and single purchase, with required bounded name', () => {
    renderForm({ events: [birthday], onSaved: vi.fn(), onCancel: vi.fn() })

    expect(screen.getByRole('combobox', { name: /event/i })).toHaveDisplayValue('Anything')
    expect(screen.getByRole('checkbox', { name: /allow multiple purchases/i })).not.toBeChecked()
    expect(screen.getByRole('textbox', { name: /gift name/i })).toHaveAttribute('maxlength', '200')
    expect(screen.getByRole('textbox', { name: /gift name/i })).toBeRequired()
    expect(screen.getByRole('textbox', { name: /link/i })).toHaveAttribute('maxlength', '2000')
    expect(screen.getByRole('textbox', { name: /price/i })).toHaveAttribute('maxlength', '80')
    expect(screen.getByRole('textbox', { name: /notes/i })).toHaveAttribute('maxlength', '5000')
  })

  it('preserves every entered value and shows server field errors after a failed save', async () => {
    api.createItem.mockRejectedValue(new ApiError(400, {
      code: 'validation_error', message: 'Please correct the highlighted fields.', fields: { name: ['A gift with this name is not allowed.'] },
    }))
    renderForm({ events: [birthday], onSaved: vi.fn(), onCancel: vi.fn() })
    const user = userEvent.setup()
    await user.type(screen.getByRole('textbox', { name: /gift name/i }), 'A book')
    await user.type(screen.getByRole('textbox', { name: /link/i }), 'https://example.com/book')
    await user.type(screen.getByRole('textbox', { name: /price/i }), '$12')
    await user.type(screen.getByRole('textbox', { name: /notes/i }), 'For the train')
    await user.selectOptions(screen.getByRole('combobox', { name: /event/i }), '1')
    await user.click(screen.getByRole('checkbox', { name: /allow multiple purchases/i }))
    await user.click(screen.getByRole('button', { name: /save/i }))

    expect(await screen.findByText('A gift with this name is not allowed.')).toBeVisible()
    expect(screen.getByRole('textbox', { name: /gift name/i })).toHaveValue('A book')
    expect(screen.getByRole('textbox', { name: /link/i })).toHaveValue('https://example.com/book')
    expect(screen.getByRole('textbox', { name: /price/i })).toHaveValue('$12')
    expect(screen.getByRole('textbox', { name: /notes/i })).toHaveValue('For the train')
    expect(screen.getByRole('combobox', { name: /event/i })).toHaveValue('1')
    expect(screen.getByRole('checkbox', { name: /allow multiple purchases/i })).toBeChecked()
  })

  it('retains an archived current event and sends only editable fields on PATCH', async () => {
    api.updateItem.mockResolvedValue(item)
    const onSaved = vi.fn()
    renderForm({ item, events: [birthday], onSaved, onCancel: vi.fn() })
    const user = userEvent.setup()
    await user.clear(screen.getByRole('textbox', { name: /gift name/i }))
    await user.type(screen.getByRole('textbox', { name: /gift name/i }), 'New name')
    await user.click(screen.getByRole('button', { name: /save/i }))

    expect(api.updateItem).toHaveBeenCalledWith(4, {
      name: 'New name', link: '', price: '', notes: '', event_id: 3, allow_multiple_purchases: false,
    })
    expect(onSaved).toHaveBeenCalledOnce()
  })

  it('retains the same event by ID when it is archived while an edit draft is open', async () => {
    const activeBirthday = { ...birthday, is_active: true }
    const birthdayItem = { ...item, event: activeBirthday }
    api.updateItem.mockResolvedValue(birthdayItem)
    const onSaved = vi.fn()
    const view = renderForm({ item: birthdayItem, events: [activeBirthday], onSaved, onCancel: vi.fn() })
    const notes = screen.getByRole('textbox', { name: /notes/i })
    await userEvent.type(notes, 'Keep these notes')

    view.rerender(<StrictMode><IdentityProvider><ItemForm item={birthdayItem} events={[]} onSaved={onSaved} onCancel={vi.fn()} /></IdentityProvider></StrictMode>)

    expect(screen.getByRole('textbox', { name: /notes/i })).toHaveValue('Keep these notes')
    expect(screen.getByRole('combobox', { name: 'Event' })).toHaveValue('1')
    expect(screen.getByRole('option', { name: 'Birthday (no longer configured; retained)' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(api.updateItem).toHaveBeenCalledWith(4, {
      name: 'Old gift', link: '', price: '', notes: 'Keep these notes', event_id: 1, allow_multiple_purchases: false,
    })
    expect(onSaved).toHaveBeenCalledOnce()
  })

  it('requires a replacement when an unsaved new event assignment disappears', async () => {
    const onSaved = vi.fn()
    const view = renderForm({ events: [birthday], onSaved, onCancel: vi.fn() })
    await userEvent.type(screen.getByRole('textbox', { name: /gift name/i }), 'Keep this gift')
    await userEvent.type(screen.getByRole('textbox', { name: /notes/i }), 'Keep these notes')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Event' }), '1')

    view.rerender(<StrictMode><IdentityProvider><ItemForm events={[]} onSaved={onSaved} onCancel={vi.fn()} /></IdentityProvider></StrictMode>)

    expect(screen.getByRole('textbox', { name: /gift name/i })).toHaveValue('Keep this gift')
    expect(screen.getByRole('textbox', { name: /notes/i })).toHaveValue('Keep these notes')
    expect(screen.getByText(/no longer configured.*choose anything or another current occasion/i)).toBeVisible()
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Event' }), '')
    expect(screen.getByRole('button', { name: /save/i })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(api.createItem).toHaveBeenCalledWith({
      name: 'Keep this gift', link: '', price: '', notes: 'Keep these notes', event_id: null, allow_multiple_purchases: false,
    })
    expect(onSaved).toHaveBeenCalledOnce()
  })

  it('revalidates after identity_required without losing the entered draft', async () => {
    api.createItem.mockRejectedValue(new ApiError(403, { code: 'identity_required', message: 'Select a person.' }))
    const profile = { id: 1, key: 'alex', name: 'Alex' }
    api.getProfiles.mockResolvedValue([profile])
    api.getSession.mockResolvedValue({ profile })
    render(<StrictMode><IdentityProvider><ItemForm events={[birthday]} onSaved={vi.fn()} onCancel={vi.fn()} /></IdentityProvider></StrictMode>)
    const user = userEvent.setup()
    const name = await screen.findByRole('textbox', { name: /gift name/i })
    await user.type(name, 'Draft survives recovery')
    api.getSession.mockClear()
    await user.click(screen.getByRole('button', { name: /save/i }))

    expect(await screen.findByRole('textbox', { name: /gift name/i })).toHaveValue('Draft survives recovery')
    expect(api.getSession).toHaveBeenCalledOnce()
  })
})

import { render, screen, within } from '@testing-library/react'
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

    expect(screen.getByRole('combobox', { name: /occasion/i })).toHaveDisplayValue('Anything')
    expect(screen.getByRole('checkbox', { name: 'Can be purchased multiple times' })).not.toBeChecked()
    expect(screen.getByRole('textbox', { name: /gift name/i })).toHaveAttribute('maxlength', '200')
    expect(screen.getByRole('textbox', { name: /gift name/i })).toBeRequired()
    expect(screen.getByRole('textbox', { name: /link/i })).toHaveAttribute('maxlength', '2000')
    expect(screen.queryByLabelText(/price/i)).not.toBeInTheDocument()
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
    await user.type(screen.getByRole('textbox', { name: /notes/i }), 'For the train')
    await user.selectOptions(screen.getByRole('combobox', { name: /occasion/i }), '1')
    await user.click(screen.getByRole('checkbox', { name: 'Can be purchased multiple times' }))
    await user.click(screen.getByRole('button', { name: /save/i }))

    expect(await screen.findByText('A gift with this name is not allowed.')).toBeVisible()
    expect(screen.getByRole('textbox', { name: /gift name/i })).toHaveValue('A book')
    expect(screen.getByRole('textbox', { name: /link/i })).toHaveValue('https://example.com/book')
    expect(screen.getByRole('textbox', { name: /notes/i })).toHaveValue('For the train')
    expect(screen.getByRole('combobox', { name: /occasion/i })).toHaveValue('1')
    expect(screen.getByRole('checkbox', { name: 'Can be purchased multiple times' })).toBeChecked()
  })

  it('associates every field error exactly once and combines event errors without duplicate IDs', async () => {
    api.createItem.mockRejectedValue(new ApiError(400, {
      code: 'validation_error', message: 'Please correct the highlighted fields.', fields: {
        name: ['Name issue one.', 'Name issue two.'],
        link: ['Link issue one.', 'Link issue two.'],
        price: ['Price issue one.', 'Price issue two.'],
        notes: ['Notes issue one.', 'Notes issue two.'],
        event_id: ['Event issue one.', 'Event issue two.'],
        allow_multiple_purchases: ['Purchase issue one.', 'Purchase issue two.'],
      },
    }))
    const view = renderForm({ events: [birthday], onSaved: vi.fn(), onCancel: vi.fn() })
    const form = screen.getByRole('form', { name: 'Add a gift' })
    const user = userEvent.setup()
    await user.type(within(form).getByRole('textbox', { name: /gift name/i }), 'Book')
    await user.selectOptions(within(form).getByRole('combobox', { name: /occasion/i }), '1')
    await user.click(within(form).getByRole('button', { name: 'Save gift' }))
    await screen.findByText(/Purchase issue two\./)

    const controls = [
      [within(form).getByRole('textbox', { name: /gift name/i }), ['Name issue one.', 'Name issue two.']],
      [within(form).getByRole('textbox', { name: /Notes/i }), ['Notes issue one.', 'Notes issue two.']],
      [within(form).getByRole('combobox', { name: /occasion/i }), ['Event issue one.', 'Event issue two.']],
      [within(form).getByRole('checkbox', { name: 'Can be purchased multiple times' }), ['Purchase issue one.', 'Purchase issue two.']],
    ] as const
    const describedIds: string[] = []
    for (const [control, messages] of controls) {
      expect(control).toHaveAttribute('aria-invalid', 'true')
      const ids = (control.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
      expect(ids.length).toBeGreaterThan(0)
      describedIds.push(...ids)
      const description = ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ')
      expect(control).toHaveAccessibleDescription(messages.join(' '))
      for (const message of messages) expect(description).toContain(message)
      expect(description.match(/issue (?:one|two)\./g)).toHaveLength(2)
      for (const id of ids) expect(document.querySelectorAll(`[id="${id}"]`)).toHaveLength(1)
    }
    expect(new Set(describedIds).size).toBe(describedIds.length)

    view.rerender(<StrictMode><IdentityProvider><ItemForm events={[]} onSaved={vi.fn()} onCancel={vi.fn()} /></IdentityProvider></StrictMode>)
    const eventControl = screen.getByRole('combobox', { name: /occasion/i })
    expect(eventControl).toHaveAttribute('aria-invalid', 'true')
    const eventDescription = (eventControl.getAttribute('aria-describedby') ?? '').split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '').join(' ')
    expect(eventControl).toHaveAccessibleDescription(/This occasion is no longer configured\..*Event issue one\. Event issue two\./)
    expect(eventDescription).toContain('Event issue one.')
    expect(eventDescription).toContain('Event issue two.')
    expect(eventDescription).toContain('This occasion is no longer configured.')
    expect(eventDescription.match(/Event issue (?:one|two)\./g)).toHaveLength(2)

    const nameControl = screen.getByRole('textbox', { name: /gift name/i })
    await user.type(nameControl, ' revised')
    expect(nameControl).not.toHaveAttribute('aria-invalid')
    expect(nameControl).not.toHaveAttribute('aria-describedby')
    expect(screen.queryByText(/Name issue one\./)).not.toBeInTheDocument()
    expect(eventControl).toHaveAttribute('aria-invalid', 'true')

    await user.selectOptions(eventControl, '')
    expect(eventControl).not.toHaveAttribute('aria-invalid')
    expect(eventControl).not.toHaveAttribute('aria-describedby')
    expect(screen.queryByText(/This occasion is no longer configured\./)).not.toBeInTheDocument()
    expect(screen.queryByText(/Event issue one\./)).not.toBeInTheDocument()

    const purchaseControl = screen.getByRole('checkbox', { name: 'Can be purchased multiple times' })
    await user.click(purchaseControl)
    expect(purchaseControl).not.toHaveAttribute('aria-invalid')
    expect(purchaseControl).not.toHaveAttribute('aria-describedby')
    expect(screen.queryByText(/Purchase issue one\./)).not.toBeInTheDocument()
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
      name: 'New name', link: '', notes: '', event_id: 3, allow_multiple_purchases: false,
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
    expect(screen.getByRole('combobox', { name: /occasion/i })).toHaveValue('1')
    expect(screen.getByRole('option', { name: 'Birthday (no longer configured; retained)' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(api.updateItem).toHaveBeenCalledWith(4, {
      name: 'Old gift', link: '', notes: 'Keep these notes', event_id: 1, allow_multiple_purchases: false,
    })
    expect(onSaved).toHaveBeenCalledOnce()
  })

  it('requires a replacement when an unsaved new event assignment disappears', async () => {
    const onSaved = vi.fn()
    const view = renderForm({ events: [birthday], onSaved, onCancel: vi.fn() })
    await userEvent.type(screen.getByRole('textbox', { name: /gift name/i }), 'Keep this gift')
    await userEvent.type(screen.getByRole('textbox', { name: /notes/i }), 'Keep these notes')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /occasion/i }), '1')

    view.rerender(<StrictMode><IdentityProvider><ItemForm events={[]} onSaved={onSaved} onCancel={vi.fn()} /></IdentityProvider></StrictMode>)

    expect(screen.getByRole('textbox', { name: /gift name/i })).toHaveValue('Keep this gift')
    expect(screen.getByRole('textbox', { name: /notes/i })).toHaveValue('Keep these notes')
    expect(screen.getByText(/no longer configured.*choose anything or another current occasion/i)).toBeVisible()
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /occasion/i }), '')
    expect(screen.getByRole('button', { name: /save/i })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(api.createItem).toHaveBeenCalledWith({
      name: 'Keep this gift', link: '', notes: 'Keep these notes', event_id: null, allow_multiple_purchases: false,
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

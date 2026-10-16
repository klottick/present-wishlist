import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { EventOption } from '../../api/types'
import { EventFilter } from './EventFilter'

const events: EventOption[] = [
  { id: 1, key: 'birthday', label: 'Birthday', is_active: true },
  { id: 2, key: 'holiday', label: 'Holiday', is_active: true },
  { id: 3, key: 'all', label: 'All Saints Day', is_active: true },
]

describe('EventFilter', () => {
  it('offers All events, Anything, and configured events with the selected value', async () => {
    const onChange = vi.fn()
    render(<EventFilter events={events} value="all" onChange={onChange} />)

    const select = screen.getByRole('combobox', { name: 'Filter by occasion' })
    expect(select).toHaveValue('filter:all')
    expect(screen.getByRole('option', { name: 'All events' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Anything' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Birthday' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Holiday' })).toBeInTheDocument()

    await userEvent.selectOptions(select, 'event:birthday')

    expect(onChange).toHaveBeenCalledWith({ key: 'birthday' })
  })

  it('keeps a configured event keyed all distinct from the All events filter', async () => {
    const onChange = vi.fn()
    render(<EventFilter events={events} value="all" onChange={onChange} />)

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filter by occasion' }), 'event:all')

    expect(onChange).toHaveBeenCalledWith({ key: 'all' })
  })

  it('distinguishes a configured event labeled All events from the synthetic option', () => {
    render(<EventFilter
      events={[{ id: 5, key: 'all-events-day', label: 'All events', is_active: true }]}
      value="all"
      onChange={() => undefined}
    />)

    const options = screen.getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual([
      'All events',
      'Anything',
      'All events (configured occasion)',
    ])
    expect(options[0]).toHaveValue('filter:all')
    expect(options[2]).toHaveValue('event:all-events-day')
  })
})

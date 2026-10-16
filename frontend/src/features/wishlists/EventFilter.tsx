import type { EventFilterValue, EventOption } from '../../api/types'

const ALL_EVENTS_VALUE = 'filter:all'
const ANYTHING_VALUE = 'filter:anything'
const EVENT_VALUE_PREFIX = 'event:'

export function EventFilter({
  events,
  value,
  onChange,
}: {
  events: EventOption[]
  value: EventFilterValue
  onChange(value: EventFilterValue): void
}) {
  const selected = value === 'all' ? ALL_EVENTS_VALUE : value === 'anything' ? ANYTHING_VALUE : `${EVENT_VALUE_PREFIX}${value.key}`
  return (
    <label className="event-filter">
      <span>Filter by occasion</span>
      <select value={selected} onChange={(event) => {
        const next = event.currentTarget.value
        onChange(next === ALL_EVENTS_VALUE ? 'all' : next === ANYTHING_VALUE ? 'anything' : { key: next.slice(EVENT_VALUE_PREFIX.length) })
      }}>
        <option value={ALL_EVENTS_VALUE}>All events</option>
        <option value={ANYTHING_VALUE}>Anything</option>
        {events.filter((option) => option.is_active).map((option) => (
          <option key={option.key} value={`${EVENT_VALUE_PREFIX}${option.key}`}>
            {option.label.toLowerCase() === 'all events' ? 'All events (configured occasion)' : option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

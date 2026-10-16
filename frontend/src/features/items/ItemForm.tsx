import { useEffect, useRef, useState } from 'react'
import { ApiError, createItem, updateItem } from '../../api/client'
import type { EventOption, ItemInput, OwnerItem } from '../../api/types'
import { useIdentity } from '../identity/IdentityProvider'

type Props = { item?: OwnerItem; events: EventOption[]; eventsReady?: boolean; onSaved: () => void; onCancel: () => void }
type Draft = Omit<ItemInput, 'event_id'> & { event_id: number | null }

export function ItemForm({ item, events, eventsReady = true, onSaved, onCancel }: Props) {
  const { generation, phase, revalidate } = useIdentity()
  const [draft, setDraft] = useState<Draft>(() => ({
    name: item?.name ?? '', link: item?.link ?? '', price: item?.price ?? '', notes: item?.notes ?? '',
    event_id: item?.event?.id ?? null, allow_multiple_purchases: item?.allow_multiple_purchases ?? false,
  }))
  const [selectedEvent, setSelectedEvent] = useState<EventOption | null>(() => item?.event ?? null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const scope = useRef({ generation, phase, revalidate, onSaved })
  const mounted = useRef(true)
  const pendingRef = useRef(false)
  scope.current = { generation, phase, revalidate, onSaved }

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const change = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }))
    setFieldErrors((current) => ({ ...current, [key]: [] }))
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pendingRef.current || scope.current.phase !== 'ready' || invalidEventAssignment) return
    pendingRef.current = true
    setPending(true)
    setError('')
    setFieldErrors({})
    const requestGeneration = scope.current.generation
    try {
      const payload: ItemInput = { ...draft }
      if (item) await updateItem(item.id, payload)
      else await createItem(payload)
      if (!mounted.current || scope.current.generation !== requestGeneration || scope.current.phase !== 'ready') return
      scope.current.onSaved()
    } catch (reason) {
      if (!mounted.current || scope.current.generation !== requestGeneration) return
      if (reason instanceof ApiError && reason.failure.code === 'identity_required') {
        void scope.current.revalidate()
        return
      }
      if (reason instanceof ApiError) {
        setFieldErrors(reason.failure.fields ?? {})
        setError(reason.failure.message)
      } else setError('The gift could not be saved. Please try again.')
    } finally {
      pendingRef.current = false
      if (mounted.current) setPending(false)
    }
  }

  const activeDraftEvent = draft.event_id === null
    ? null
    : events.find((option) => option.id === draft.event_id && option.is_active) ?? null
  const currentEvent = item?.event && item.event.id === draft.event_id && !activeDraftEvent
    && (!item.event.is_active || eventsReady) ? item.event : null
  const removedDraftEvent = eventsReady && draft.event_id !== null && !activeDraftEvent && !currentEvent
    ? selectedEvent : null
  const invalidEventAssignment = eventsReady && draft.event_id !== null && !activeDraftEvent && !currentEvent
  return (
    <form className="item-form" onSubmit={(event) => void submit(event)} aria-labelledby="item-form-title">
      <h2 id="item-form-title">{item ? 'Edit gift' : 'Add a gift'}</h2>
      {error && <p role="alert">{error}</p>}
      <label>Gift name <span aria-hidden="true">*</span>
        <input autoFocus required maxLength={200} value={draft.name} onChange={(event) => change('name', event.target.value)} aria-invalid={fieldErrors.name?.length ? true : undefined} aria-describedby={fieldErrors.name?.length ? 'gift-name-error' : undefined} />
      </label>
      {fieldErrors.name?.map((message) => <p className="field-error" id="gift-name-error" key={message}>{message}</p>)}
      <label>Link <input type="url" maxLength={2000} value={draft.link} onChange={(event) => change('link', event.target.value)} aria-invalid={fieldErrors.link?.length ? true : undefined} /></label>
      {fieldErrors.link?.map((message) => <p className="field-error" key={message}>{message}</p>)}
      <label>Price <input maxLength={80} value={draft.price} onChange={(event) => change('price', event.target.value)} aria-invalid={fieldErrors.price?.length ? true : undefined} /></label>
      {fieldErrors.price?.map((message) => <p className="field-error" key={message}>{message}</p>)}
      <label>Notes <textarea maxLength={5000} value={draft.notes} onChange={(event) => change('notes', event.target.value)} aria-invalid={fieldErrors.notes?.length ? true : undefined} /></label>
      {fieldErrors.notes?.map((message) => <p className="field-error" key={message}>{message}</p>)}
      <label>Event
        <select
          value={draft.event_id === null ? '' : String(draft.event_id)}
          aria-invalid={invalidEventAssignment || fieldErrors.event_id?.length ? true : undefined}
          aria-describedby={invalidEventAssignment ? 'removed-event-error' : undefined}
          onChange={(event) => {
            const eventId = event.currentTarget.value ? Number(event.currentTarget.value) : null
            setSelectedEvent(events.find((option) => option.id === eventId) ?? null)
            change('event_id', eventId)
          }}
        >
          <option value="">Anything</option>
          {currentEvent && <option value={currentEvent.id} disabled>{currentEvent.label} (no longer configured; retained)</option>}
          {removedDraftEvent && <option value={removedDraftEvent.id} disabled>
            {removedDraftEvent.label} (no longer configured; choose another)
          </option>}
          {events.filter((option) => option.is_active).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </label>
      {invalidEventAssignment && <p className="field-error" id="removed-event-error">
        This occasion is no longer configured. Choose Anything or another current occasion before saving.
      </p>}
      {fieldErrors.event_id?.map((message) => <p className="field-error" key={message}>{message}</p>)}
      <label className="checkbox-label"><input type="checkbox" checked={draft.allow_multiple_purchases} onChange={(event) => change('allow_multiple_purchases', event.target.checked)} /> Allow multiple purchases</label>
      {fieldErrors.allow_multiple_purchases?.map((message) => <p className="field-error" key={message}>{message}</p>)}
      <div className="form-actions">
         <button className="primary-button" type="submit" disabled={pending || invalidEventAssignment}>{pending ? 'Saving…' : 'Save gift'}</button>
        <button className="secondary-button" type="button" onClick={onCancel} disabled={pending}>Cancel</button>
      </div>
    </form>
  )
}

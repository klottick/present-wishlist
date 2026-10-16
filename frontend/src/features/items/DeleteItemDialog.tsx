import { useEffect, useRef, useState } from 'react'
import { ApiError, deleteItem } from '../../api/client'
import type { OwnerItem } from '../../api/types'
import { useIdentity } from '../identity/IdentityProvider'

type Props = { item: OwnerItem; onDeleted: () => void; onCancel: () => void; getReturnFocusTarget?: () => HTMLElement | null }

export function DeleteItemDialog({ item, onDeleted, onCancel, getReturnFocusTarget }: Props) {
  const { generation, phase, profile, revalidate } = useIdentity()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const dialog = useRef<HTMLDivElement>(null)
  const dialogIdentityId = useRef(profile?.id)
  const previousPhase = useRef(phase)
  const scope = useRef({ generation, phase, profile, revalidate, onDeleted, onCancel, getReturnFocusTarget })
  const mounted = useRef(true)
  const pendingRef = useRef(false)
  scope.current = { generation, phase, profile, revalidate, onDeleted, onCancel, getReturnFocusTarget }

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    mounted.current = true
    const cancel = dialog.current?.querySelector<HTMLButtonElement>('[data-cancel]')
    cancel?.focus()
    return () => {
      mounted.current = false
      const logicalTarget = scope.current.getReturnFocusTarget?.()
      const returnTarget = logicalTarget?.isConnected ? logicalTarget : previous?.isConnected ? previous : null
      returnTarget?.focus()
    }
  }, [])

  useEffect(() => {
    if (phase === 'ready' && previousPhase.current !== 'ready' && profile?.id === dialogIdentityId.current) {
      const target = dialog.current?.querySelector<HTMLElement>('[data-cancel]:not(:disabled)') ?? dialog.current
      target?.focus()
    }
    previousPhase.current = phase
  }, [generation, phase, profile?.id])

  const confirm = async () => {
    if (pendingRef.current || scope.current.phase !== 'ready') return
    pendingRef.current = true
    setPending(true)
    setError('')
    dialog.current?.focus()
    const requestGeneration = scope.current.generation
    try {
      await deleteItem(item.id)
      if (!mounted.current || scope.current.generation !== requestGeneration || scope.current.phase !== 'ready') return
      scope.current.onDeleted()
    } catch (reason) {
      if (!mounted.current) return
      const currentRequest = scope.current.generation === requestGeneration && scope.current.phase === 'ready'
      const sameIdentityRecovery = scope.current.phase === 'ready' && scope.current.profile?.id === dialogIdentityId.current
      if (!currentRequest && !sameIdentityRecovery) return
      if (reason instanceof ApiError && reason.failure.code === 'identity_required') {
        if (!currentRequest) return
        void scope.current.revalidate()
        return
      }
      setError(reason instanceof ApiError ? reason.failure.message : 'The gift could not be deleted. Please try again.')
    } finally {
      pendingRef.current = false
      if (mounted.current) setPending(false)
    }
  }

  const containKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !pending) {
      event.preventDefault()
      scope.current.onCancel()
    }
    if (event.key !== 'Tab') return
    const controls = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled)')
    if (!controls?.length) {
      event.preventDefault()
      dialog.current?.focus()
      return
    }
    const first = controls[0]
    const last = controls[controls.length - 1]
    if (document.activeElement === dialog.current) {
      event.preventDefault()
      const target = event.shiftKey ? last : first
      target.focus()
      return
    }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  return (
    <div className="dialog-backdrop">
      <div ref={dialog} className="confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title" tabIndex={-1} onKeyDown={containKeys}>
        <h2 id="delete-dialog-title">Delete gift?</h2>
        <p>Delete “{item.name}” from this wishlist?</p>
        {error && <p role="alert">{error}</p>}
        <div className="form-actions">
          <button className="danger-button" type="button" onClick={() => void confirm()} disabled={pending}>{pending ? 'Deleting…' : 'Delete gift'}</button>
          <button className="secondary-button" type="button" data-cancel onClick={onCancel} disabled={pending}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

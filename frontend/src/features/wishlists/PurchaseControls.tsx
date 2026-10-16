import { useEffect, useRef, useState } from 'react'
import { ApiError, markPurchased, undoPurchase } from '../../api/client'
import type { OtherItem } from '../../api/types'
import { useIdentity } from '../identity/IdentityProvider'

export function PurchaseControls({ item, onChanged, onConflict }: {
  item: OtherItem
  onChanged: () => void
  onConflict: () => void
}) {
  const { generation, phase, profile, revalidate } = useIdentity()
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)
  const [notice, setNotice] = useState<string | null>(null)
  const identity = useRef({ generation, phase })
  const mounted = useRef(true)
  identity.current = { generation, phase }

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    pendingRef.current = false
    setPending(false)
    setNotice(null)
  }, [generation, phase])

  const current = () => mounted.current && identity.current.generation === generation
    && identity.current.phase === phase
    && identity.current.phase === 'ready'

  async function submit(action: 'mark' | 'undo') {
    if (phase !== 'ready' || pendingRef.current || !profile || (action === 'mark' ? !item.can_purchase : !item.can_undo)) return
    pendingRef.current = true
    setPending(true)
    setNotice(null)
    try {
      if (action === 'mark') await markPurchased(item.id)
      else await undoPurchase(item.id)
      if (!current()) return
      setNotice(action === 'mark' ? 'You marked this gift as purchased.' : 'Your purchase mark was removed.')
      onChanged()
    } catch (reason) {
      if (!current()) return
      if (reason instanceof ApiError && reason.failure.code === 'identity_required') {
        void revalidate()
        return
      }
      if (reason instanceof ApiError && reason.status === 409) {
        onConflict()
        return
      }
      setNotice('We could not update this purchase. Please try again.')
    } finally {
      if (current()) {
        pendingRef.current = false
        setPending(false)
      }
    }
  }

  const buyers = item.purchases.map((purchase) => purchase.buyer_name).join(', ')
  return (
    <div className="purchase-controls">
      {buyers && <p>Already marked by: {buyers}</p>}
      {item.can_purchase && <button type="button" className="secondary-button" disabled={pending || phase !== 'ready'} onClick={() => void submit('mark')}>
        Mark purchased
      </button>}
      {item.can_undo && <button type="button" className="secondary-button" disabled={pending || phase !== 'ready'} onClick={() => void submit('undo')}>
        Undo my purchase
      </button>}
      {notice && <p role="status">{notice}</p>}
      {pending && <p role="status">Updating purchase…</p>}
    </div>
  )
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ApiError, getItems } from '../../api/client'
import type { EventFilterValue, Item } from '../../api/types'
import { useIdentity } from '../identity/IdentityProvider'

type WishlistResult = {
  key: string
  items: Item[]
  error: ApiError | null
  refreshVersion: number
}

export function useWishlist(ownerId: number, filter: EventFilterValue, generation: number, enabled = true) {
  const { phase, revalidate } = useIdentity()
  const [result, setResult] = useState<WishlistResult>({ key: '', items: [], error: null, refreshVersion: -1 })
  const [loading, setLoading] = useState(true)
  const [refreshVersion, setRefreshVersion] = useState(0)
  const scopeKey = useMemo(() => JSON.stringify([
    ownerId,
    filter === 'all' ? ['all'] : filter === 'anything' ? ['anything'] : ['event', filter.key],
    generation,
  ]), [ownerId, filter, generation])

  useEffect(() => {
    if (phase !== 'ready' || !enabled) {
      setLoading(true)
      return
    }
    const controller = new AbortController()
    let current = true
    setLoading(true)
    setResult((previous) => ({ ...previous, error: null }))

    getItems(ownerId, filter, controller.signal).then(
      (items) => {
        if (!current) return
        setResult({ key: scopeKey, items, error: null, refreshVersion })
        setLoading(false)
      },
    ).catch((reason: unknown) => {
      if (!current || isAbort(reason)) return
      if (reason instanceof ApiError && reason.failure.code === 'identity_required') {
        setResult({ key: scopeKey, items: [], error: null, refreshVersion })
        void revalidate()
        return
      }
      setResult({ key: scopeKey, items: [], error: reason instanceof ApiError ? reason : new ApiError(0, {
        code: 'request_error', message: 'The wishlist could not be loaded.',
      }), refreshVersion })
      setLoading(false)
    })

    return () => {
      current = false
      controller.abort()
    }
  }, [ownerId, filter, generation, phase, enabled, refreshVersion, revalidate, scopeKey])

  const refresh = useCallback(() => setRefreshVersion((version) => version + 1), [])
  const matchesCurrentScope = result.key === scopeKey
  return {
    items: matchesCurrentScope ? result.items : [],
    loading: loading || !matchesCurrentScope,
    error: matchesCurrentScope ? result.error : null,
    refreshVersion,
    settledRefreshVersion: matchesCurrentScope ? result.refreshVersion : -1,
    refresh,
  }
}

function isAbort(reason: unknown): boolean {
  return reason instanceof DOMException && reason.name === 'AbortError'
}

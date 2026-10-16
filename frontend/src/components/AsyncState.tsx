import type { ReactNode } from 'react'

export function AsyncState({
  loading,
  error,
  onRetry,
  children,
}: {
  loading: boolean
  error?: string | null
  onRetry?: () => void
  children?: ReactNode
}) {
  if (loading) return <p role="status">Loading…</p>
  if (error) {
    return (
      <div role="alert">
        <p>{error}</p>
        {onRetry && <button type="button" onClick={onRetry}>Retry</button>}
      </div>
    )
  }
  return children ?? null
}

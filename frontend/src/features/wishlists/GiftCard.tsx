import type { ReactNode } from 'react'
import type { Item } from '../../api/types'

export function GiftCard({ item, children }: { item: Item; children?: ReactNode }) {
  const safeLink = getSafeExternalLink(item.link)
  return (
    <article className="gift-card">
      <div className="gift-card-heading">
        <h2>{item.name}</h2>
        <span className="gift-event-label">
          {item.event?.label ?? 'Anything'}{item.event && !item.event.is_active && <span className="archived-label"> (no longer configured)</span>}
        </span>
      </div>
      {item.notes && <p className="gift-notes">{item.notes}</p>}
      {item.allow_multiple_purchases && <p className="gift-repeatability">This gift can be purchased by more than one person.</p>}
      {safeLink && <p><a href={safeLink} target="_blank" rel="noopener noreferrer">View gift link</a></p>}
      {children}
    </article>
  )
}

function getSafeExternalLink(link: string): string | null {
  if (!link) return null
  try {
    const url = new URL(link)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

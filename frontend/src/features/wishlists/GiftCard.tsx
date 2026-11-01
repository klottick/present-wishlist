import type { ReactNode } from 'react'
import type { Item } from '../../api/types'
import { LinkPreview, safeExternalLink } from './LinkPreview'

export function GiftCard({ item, children, previewScope = 0 }: { item: Item; children?: ReactNode; previewScope?: number }) {
  const safeLink = safeExternalLink(item.link)
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
      {item.links?.length ? <div className="gift-links" aria-label="Shopping links">
        {item.links.map((link) => <LinkPreview key={`${previewScope}-${link.id}`} link={link} scope={previewScope} />)}
      </div> : safeLink && <p><a href={safeLink} target="_blank" rel="noopener noreferrer">View gift link</a></p>}
      {children}
    </article>
  )
}

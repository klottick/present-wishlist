import { useEffect, useState } from 'react'
import type { GiftLink, LinkMetadata } from '../../api/types'
import { subscribePreview } from './previewRequests'

export function safeExternalLink(value: string): string | null {
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url.href : null
  } catch { return null }
}

export function LinkPreview({ link, scope = 0 }: { link: GiftLink; scope?: number }) {
  const key = `${scope}:${link.id}:${link.url}`
  const [result, setResult] = useState<{ key: string; data: LinkMetadata } | null>(null)
  const [brokenImage, setBrokenImage] = useState<string | null>(null)
  const href = safeExternalLink(link.url)
  useEffect(() => {
    if (!href) return
    let active = true
    const request = subscribePreview(key, link.id)
    request.promise.then((data) => { if (active) setResult({ key, data }) }).catch(() => undefined)
    return () => { active = false; request.release() }
  }, [href, key, link.id])
  if (!href) return null
  const metadata = result?.key === key ? result.data : null
  const hostname = new URL(href).hostname
  const title = metadata?.title || hostname
  const image = metadata?.image_url ? safeExternalLink(metadata.image_url) : null
  return <a className="link-preview" href={href} target="_blank" rel="noopener noreferrer">
    {image && brokenImage !== image && <img className="link-preview-image" src={image} alt={`Preview of ${title}`}
      loading="lazy" referrerPolicy="no-referrer" onError={() => setBrokenImage(image)} />}
    <span className="link-preview-content">
      <span className="link-preview-title">{title}</span>
      {metadata?.description && <span className="link-preview-description">{metadata.description}</span>}
      <span className="link-preview-host">{metadata?.title ? hostname : new URL(href).pathname === '/' ? 'Open website' : new URL(href).pathname}</span>
    </span>
    <svg className="external-link-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M14 4h6v6m0-6L10 14M10 5H5v14h14v-5" />
    </svg>
  </a>
}

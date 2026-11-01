import { useState } from 'react'
import type { Profile } from '../api/types'

export function Avatar({ profile, large = false }: { profile: Profile; large?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null)
  const initials = profile.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
  return <span className={`avatar${large ? ' avatar-large' : ''}`} aria-hidden="true">
    {profile.avatar_url && failed !== profile.avatar_url
      ? <img src={profile.avatar_url} alt="" onError={() => setFailed(profile.avatar_url ?? null)} />
      : initials}
  </span>
}

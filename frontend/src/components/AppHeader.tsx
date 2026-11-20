import type { Profile } from '../api/types'
import { useFamilyBranding } from '../features/branding/FamilyBranding'
import { Avatar } from './Avatar'

export function AppHeader({ profile, onSwitch }: { profile: Profile; onSwitch(): void }) {
  const branding = useFamilyBranding()
  return (
    <header className="app-header">
      <a className="app-title" href="/">{branding.appTitle}</a>
      <div className="current-identity">
        <span className="identity-label"><Avatar profile={profile} /> <span>Viewing as <strong>{profile.name}</strong></span></span>
        <button type="button" onClick={onSwitch}>Switch name</button>
      </div>
    </header>
  )
}

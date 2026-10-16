import type { Profile } from '../api/types'

export function AppHeader({ profile, onSwitch }: { profile: Profile; onSwitch(): void }) {
  return (
    <header className="app-header">
      <a className="app-title" href="/">Family Wishlist</a>
      <div className="current-identity">
        <span>Viewing as <strong>{profile.name}</strong></span>
        <button type="button" onClick={onSwitch}>Switch name</button>
      </div>
    </header>
  )
}

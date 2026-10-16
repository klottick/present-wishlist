import { useState } from 'react'
import { AppHeader } from './components/AppHeader'
import { AsyncState } from './components/AsyncState'
import { IdentityProvider, useIdentity } from './features/identity/IdentityProvider'
import { NamePicker } from './features/identity/NamePicker'
import { WishlistPage } from './features/wishlists/WishlistPage'

function AuthenticatedArea({ profile, profiles, onSwitch }: { profile: NonNullable<ReturnType<typeof useIdentity>['profile']>; profiles: ReturnType<typeof useIdentity>['profiles']; onSwitch(): void }) {
  const [view, setView] = useState<'mine' | 'family'>('mine')
  const [familyOwnerId, setFamilyOwnerId] = useState<number | null>(null)
  const familyOwner = profiles.find((candidate) => candidate.id === familyOwnerId)
  return (
    <div className="authenticated-area" key={profile.id}>
      <AppHeader profile={profile} onSwitch={onSwitch} />
      <main className="page-shell">
        <nav className="wishlist-navigation" aria-label="Wishlist navigation">
          <button type="button" aria-current={view === 'mine' ? 'page' : undefined} onClick={() => setView('mine')}>My wishlist</button>
          <button type="button" aria-current={view === 'family' ? 'page' : undefined} onClick={() => { setView('family'); setFamilyOwnerId(null) }}>Family wishlists</button>
        </nav>
        {view === 'mine'
          ? <WishlistPage key={`mine-${profile.id}`} owner={profile} />
          : <section className="family-browser" aria-labelledby="family-title">
            <h1 id="family-title">Family wishlists</h1>
            <div className="family-members" aria-label="Family members">
              {profiles.filter((candidate) => candidate.id !== profile.id).map((candidate) => (
                <button type="button" key={candidate.id} aria-pressed={familyOwnerId === candidate.id}
                  onClick={() => setFamilyOwnerId(candidate.id)}>
                  View {candidate.name}’s wishlist
                </button>
              ))}
              {profiles.length === 1 && <p>No other family wishlists are available.</p>}
            </div>
            {familyOwnerId !== null && !familyOwner && <div className="unavailable-profile" role="status">
              <p>This wishlist is no longer available. Choose another family member above or return to My wishlist.</p>
              <button className="secondary-button" type="button" onClick={() => setView('mine')}>Return to My wishlist</button>
            </div>}
            {familyOwner && <WishlistPage key={`family-${profile.id}-${familyOwner.id}`} owner={familyOwner} />}
          </section>}
      </main>
    </div>
  )
}

function IdentityGate() {
  const { profile, phase, profiles, choose, clear, revalidate, error } = useIdentity()
  const checking = phase === 'loading' || phase === 'checking' || phase === 'changing'

  if (phase === 'error') {
    return (
      <>
        {profile && <div hidden inert><AuthenticatedArea profile={profile} profiles={profiles} onSwitch={() => void clear()} /></div>}
        <main className="page-shell"><AsyncState loading={false} error={error} onRetry={() => void revalidate()} /></main>
      </>
    )
  }

  if (profile) {
    return (
      <>
        <div hidden={checking} inert={checking}>
          <AuthenticatedArea profile={profile} profiles={profiles} onSwitch={() => void clear()} />
        </div>
        {checking && <main className="page-shell"><p role="status">{phase === 'loading' ? 'Loading…' : 'Checking your identity…'}</p></main>}
      </>
    )
  }

  if (checking) return <main className="page-shell"><p role="status">Loading…</p></main>
  return <main className="page-shell"><NamePicker profiles={profiles} onChoose={choose} pending={false} /></main>
}

export default function App() {
  return <IdentityProvider><IdentityGate /></IdentityProvider>
}

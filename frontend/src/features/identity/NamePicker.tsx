import type { Profile } from '../../api/types'

export function NamePicker({
  profiles,
  onChoose,
  pending,
}: {
  profiles: Profile[]
  onChoose(id: number): void | Promise<void>
  pending: boolean
}) {
  return (
    <section className="identity-picker" aria-labelledby="identity-title">
      <h1 id="identity-title">Choose your name</h1>
      {profiles.length === 0 ? (
        <p>No family members are configured. Add names in <code>backend/config/family.yaml</code>, then restart the backend.</p>
      ) : (
        <div className="identity-options">
          {profiles.map((profile) => (
            <button key={profile.id} type="button" disabled={pending} onClick={() => void onChoose(profile.id)}>
              {profile.name}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

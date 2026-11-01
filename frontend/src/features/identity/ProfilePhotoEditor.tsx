import { useEffect, useId, useRef, useState } from 'react'
import { ApiError, removeAvatar, uploadAvatar } from '../../api/client'
import { Avatar } from '../../components/Avatar'
import { useIdentity } from './IdentityProvider'

export function ProfilePhotoEditor() {
  const { profile, phase, generation, updateProfile, revalidate } = useIdentity()
  const panelId = useId()
  const [expanded, setExpanded] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const mounted = useRef(false)
  const inFlight = useRef(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const current = useRef({ phase, generation, profileId: profile?.id })
  current.current = { phase, generation, profileId: profile?.id }

  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (!file) { setPreview(null); return }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  if (!profile) return null
  const changePhoto = async (remove: boolean) => {
    if (phase !== 'ready' || inFlight.current || (!remove && !file)) return
    const requestGeneration = generation
    const profileId = profile.id
    inFlight.current = true
    setPending(true)
    setError('')
    setNotice('')
    const isCurrent = () => mounted.current && current.current.phase === 'ready'
      && current.current.generation === requestGeneration && current.current.profileId === profileId
    try {
      const updated = remove ? await removeAvatar() : await uploadAvatar(file!)
      if (!isCurrent()) return
      updateProfile(updated, requestGeneration)
      setFile(null)
      setExpanded(false)
      setNotice(remove ? 'Profile photo removed.' : 'Profile photo updated.')
      trigger.current?.focus()
    } catch (reason) {
      if (!isCurrent()) return
      if (reason instanceof ApiError && reason.failure.code === 'identity_required') {
        void revalidate()
      } else {
        setError(reason instanceof ApiError
          ? reason.failure.fields?.photo?.join(' ') || reason.message
          : 'We could not update your photo. Please try again.')
      }
    } finally {
      inFlight.current = false
      if (mounted.current) setPending(false)
    }
  }

  return <section className="profile-photo-editor" aria-label="Profile photo settings">
    <button ref={trigger} type="button" className="secondary-button" aria-expanded={expanded} aria-controls={panelId}
      onClick={() => { setExpanded(!expanded); setError(''); setNotice(''); setFile(null) }}>Profile photo</button>
    {notice && <p role="status" className="photo-notice">{notice}</p>}
    {expanded && <form id={panelId} className="photo-form" onSubmit={(event) => { event.preventDefault(); void changePhoto(false) }}>
      <div className="photo-preview">
        {preview ? <img className="avatar avatar-large" src={preview} alt="Selected photo preview" /> : <Avatar profile={profile} large />}
        <p>Choose a photo for {profile.name}. It will be cropped to a square.</p>
      </div>
      <label>Choose a photo
        <input type="file" accept="image/jpeg,image/png,image/webp" disabled={pending} aria-describedby={`${panelId}-help${error ? ` ${panelId}-error` : ''}`}
          onChange={(event) => {
            const selected = event.target.files?.[0] ?? null
            setError('')
            if (selected && selected.size > 5 * 1024 * 1024) {
              setError('Choose a photo no larger than 5 MB.')
              setFile(null)
            } else setFile(selected)
          }} />
      </label>
      <p className="photo-help" id={`${panelId}-help`}>JPEG, PNG, or WebP. Up to 5 MB.</p>
      {error && <p role="alert" id={`${panelId}-error`}>{error}</p>}
      <div className="form-actions">
        <button type="submit" className="primary-button" disabled={pending || !file}>{pending ? 'Updating photo…' : 'Save photo'}</button>
        {profile.avatar_url && <button type="button" className="secondary-button" disabled={pending} onClick={() => void changePhoto(true)}>Remove photo</button>}
        <button type="button" className="secondary-button" disabled={pending}
          onClick={() => { setExpanded(false); setFile(null); setError(''); trigger.current?.focus() }}>Cancel</button>
      </div>
    </form>}
  </section>
}

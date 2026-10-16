import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ApiError, clearSession, getProfiles, getSession, selectProfile } from '../../api/client'
import type { Profile } from '../../api/types'

export type IdentityPhase = 'loading' | 'ready' | 'checking' | 'changing' | 'error'
type IdentityValue = {
  profile: Profile | null
  phase: IdentityPhase
  generation: number
  choose(id: number): Promise<void>
  clear(): Promise<void>
  revalidate(): Promise<void>
  profiles: Profile[]
  error: string | null
}

const IdentityContext = createContext<IdentityValue | null>(null)

export function IdentityProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [phase, setPhase] = useState<IdentityPhase>('loading')
  const [generation, setGeneration] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const generationRef = useRef(0)
  const readRef = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  const sessionWriteQueue = useRef<Promise<void>>(Promise.resolve())
  const pendingSessionWrites = useRef(0)

  const beginGeneration = useCallback(() => {
    generationRef.current += 1
    setGeneration(generationRef.current)
    readRef.current?.abort()
    readRef.current = null
    return generationRef.current
  }, [])

  const reconcile = useCallback(async (): Promise<Profile | null | undefined> => {
    // A GET made while a session mutation is still in flight can only observe
    // pre-write state. The final owned write always performs a fresh reconcile.
    if (!mounted.current || pendingSessionWrites.current > 0) return undefined
    const current = beginGeneration()
    const controller = new AbortController()
    readRef.current = controller
    setError(null)
    setPhase('checking')
    try {
      const [available, session] = await Promise.all([
        getProfiles(controller.signal),
        getSession(controller.signal),
      ])
      if (!mounted.current || generationRef.current !== current) return
      setProfiles(available)
      setProfile(session.profile)
      setPhase('ready')
      return session.profile
    } catch (reason) {
      if (!mounted.current || generationRef.current !== current || isAbort(reason)) return undefined
      if (reason instanceof ApiError && reason.failure.code === 'identity_required') {
        setProfile(null)
        setPhase('ready')
        return null
      } else {
        setError('We could not check your identity. Please try again.')
        setPhase('error')
        return undefined
      }
    } finally {
      if (readRef.current === controller) readRef.current = null
    }
  }, [beginGeneration])

  const revalidate = useCallback(async () => {
    await reconcile()
  }, [reconcile])

  const mutateSession = useCallback((
    mutation: () => Promise<unknown>,
    expectedProfileId: number | null,
    failureMessage: string,
  ) => {
    beginGeneration()
    pendingSessionWrites.current += 1
    setProfile(null)
    setError(null)
    setPhase('changing')
    const task = sessionWriteQueue.current.catch(() => undefined).then(async () => {
      let failed = false
      try {
        await mutation()
      } catch {
        // A lost/failed response does not prove that the server stayed unchanged.
        // Reconcile after every owned write before presenting an identity again.
        failed = true
      } finally {
        pendingSessionWrites.current -= 1
      }
      if (pendingSessionWrites.current === 0 && mounted.current) {
        const actualProfile = await reconcile()
        if (failed && actualProfile !== undefined && (actualProfile?.id ?? null) !== expectedProfileId) {
          setError(failureMessage)
          setPhase('error')
        }
      }
    })
    sessionWriteQueue.current = task.catch(() => undefined)
    return task
  }, [beginGeneration, reconcile])

  const choose = useCallback((id: number) => mutateSession(
    () => selectProfile(id), id, 'We could not check your identity. Please try again.',
  ), [mutateSession])

  const clear = useCallback(() => mutateSession(
    () => clearSession(), null, 'We could not clear the selected identity. Please try again.',
  ), [mutateSession])

  useEffect(() => {
    mounted.current = true
    let current = beginGeneration()
    const controller = new AbortController()
    readRef.current = controller
    const selectedSession = getSession(controller.signal).catch((reason: unknown) => {
      if (reason instanceof ApiError && reason.failure.code === 'identity_required') {
        return { profile: null }
      }
      throw reason
    })
    Promise.all([getProfiles(controller.signal), selectedSession]).then(
      ([available, session]) => {
        if (!mounted.current || generationRef.current !== current) return
        setProfiles(available)
        setProfile(session.profile)
        setPhase('ready')
      },
    ).catch((reason: unknown) => {
      if (!mounted.current || generationRef.current !== current || isAbort(reason)) return
      setError('We could not load your family. Please try again.')
      setPhase('error')
    })
    const onFocus = () => { void revalidate() }
    const onBlur = () => {
      beginGeneration()
      setError(null)
      setPhase('checking')
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void revalidate()
    }
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      mounted.current = false
      current += 1
      readRef.current?.abort()
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [beginGeneration, revalidate])

  const value = useMemo(() => ({ profile, phase, generation, choose, clear, revalidate, profiles, error }),
    [profile, phase, generation, choose, clear, revalidate, profiles, error])
  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>
}

export function useIdentity(): IdentityValue {
  const value = useContext(IdentityContext)
  if (!value) throw new Error('useIdentity must be used within IdentityProvider')
  return value
}

function isAbort(reason: unknown): boolean {
  return reason instanceof DOMException && reason.name === 'AbortError'
}

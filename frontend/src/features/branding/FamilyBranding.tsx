import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

type Branding = { appTitle: string; familyHeading: string }
const generic: Branding = { appTitle: 'Family Wishlist', familyHeading: 'Family wishlists' }
const BrandingContext = createContext(generic)

export function FamilyBrandingProvider({ children }: { children: ReactNode }) {
  const [familyName, setFamilyName] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void fetch('/api/config/', { signal: controller.signal })
      .then((response) => response.ok ? response.json() as Promise<{ family_name?: unknown }> : null)
      .then((data) => {
        if (typeof data?.family_name === 'string' && data.family_name.trim()) setFamilyName(data.family_name.trim())
      })
      .catch(() => undefined)
    return () => {
      controller.abort()
      document.title = generic.appTitle
    }
  }, [])

  const value = familyName
    ? { appTitle: `${familyName} Family Wishlist`, familyHeading: `${familyName} Family wishlists` }
    : generic
  useEffect(() => { document.title = value.appTitle }, [value.appTitle])
  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>
}

export function useFamilyBranding() {
  return useContext(BrandingContext)
}

import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { FamilyBrandingProvider, useFamilyBranding } from './FamilyBranding'

function Display() {
  const branding = useFamilyBranding()
  return <><h1>{branding.familyHeading}</h1><output>{branding.appTitle}</output></>
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.title = '' })

it('falls back to generic labels when branding cannot be fetched', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
  render(<FamilyBrandingProvider><Display /></FamilyBrandingProvider>)
  expect(await screen.findByRole('heading', { name: 'Family wishlists' })).toBeInTheDocument()
  expect(screen.getByText('Family Wishlist')).toBeInTheDocument()
})

it('restores the generic document title when its provider unmounts', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ family_name: 'Smith' }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })))
  const view = render(<FamilyBrandingProvider><Display /></FamilyBrandingProvider>)
  expect(await screen.findByText('Smith Family Wishlist')).toBeInTheDocument()
  expect(document.title).toBe('Smith Family Wishlist')
  view.unmount()
  expect(document.title).toBe('Family Wishlist')
})

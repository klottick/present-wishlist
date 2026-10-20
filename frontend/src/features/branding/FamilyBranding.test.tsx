import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { FamilyBrandingProvider, useFamilyBranding } from './FamilyBranding'

function Display() {
  const branding = useFamilyBranding()
  return <><h1>{branding.familyHeading}</h1><output>{branding.appTitle}</output></>
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.title = '' })

it.each([
  ['request rejected', () => Promise.reject(new Error('offline'))],
  ['server unavailable', () => Promise.resolve(new Response('', { status: 503 }))],
  ['malformed response', () => Promise.resolve(new Response('{', { status: 200 }))],
])('keeps generic labels after a settled %s response', async (_case, fetchResult) => {
  vi.stubGlobal('fetch', vi.fn(fetchResult))
  render(<FamilyBrandingProvider><Display /></FamilyBrandingProvider>)
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  expect(screen.getByRole('heading', { name: 'Family wishlists' })).toBeInTheDocument()
  expect(screen.getByText('Family Wishlist')).toBeInTheDocument()
  expect(document.title).toBe('Family Wishlist')
})

it.each([undefined, null, '', '   '])('uses generic labels for an omitted, null, or blank name (%s)', async (family_name) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ family_name }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })))
  render(<FamilyBrandingProvider><Display /></FamilyBrandingProvider>)
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  expect(screen.getByRole('heading', { name: 'Family wishlists' })).toBeInTheDocument()
  expect(document.title).toBe('Family Wishlist')
})

it('renders Unicode, apostrophes, and markup-shaped names as text', async () => {
  const family_name = "O’Brien 👨‍👩‍👧 <img src=x onerror=alert(1)>"
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ family_name }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })))
  render(<FamilyBrandingProvider><Display /></FamilyBrandingProvider>)
  expect(await screen.findByRole('heading', { name: `${family_name} Family wishlists` })).toBeInTheDocument()
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  expect(document.title).toBe(`${family_name} Family Wishlist`)
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

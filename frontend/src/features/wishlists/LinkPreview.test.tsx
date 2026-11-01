import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { LinkPreview } from './LinkPreview'

const api = vi.hoisted(() => ({ getLinkPreview: vi.fn() }))
vi.mock('../../api/client', async (original) => ({ ...await original<typeof import('../../api/client')>(), ...api }))
afterEach(() => vi.resetAllMocks())
const link = { id: 18, url: 'https://shop.example/book' }

it('shows a usable link while loading and a text-only metadata card when ready', async () => {
  api.getLinkPreview.mockResolvedValue({ url: link.url, title: '<b>A book</b>', description: 'A lovely read', image_url: 'https://shop.example/cover.jpg', site_name: 'shop.example', status: 'ready' })
  render(<LinkPreview link={link} scope={1} />)
  expect(screen.getByRole('link')).toHaveAttribute('href', link.url)
  expect(await screen.findByText('<b>A book</b>')).toBeVisible()
  expect(document.querySelector('b')).not.toBeInTheDocument()
  const image = screen.getByRole('img', { name: 'Preview of <b>A book</b>' })
  expect(image).toHaveAttribute('referrerpolicy', 'no-referrer')
  fireEvent.error(image)
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  expect(screen.getByRole('link')).toHaveAttribute('rel', 'noopener noreferrer')
})

it('keeps the destination usable after a failed preview', async () => {
  api.getLinkPreview.mockRejectedValue(new Error('Unavailable'))
  render(<LinkPreview link={{ ...link, id: 19 }} scope={1} />)
  expect(await screen.findByText('shop.example')).toBeVisible()
  expect(screen.getByRole('link')).toHaveAttribute('href', link.url)
})

it('ignores a preview response from the previous identity generation', async () => {
  let resolve!: (value: unknown) => void
  api.getLinkPreview.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
  const view = render(<LinkPreview link={{ ...link, id: 20 }} scope={1} />)
  api.getLinkPreview.mockResolvedValue({ title: 'Current title', description: '', image_url: null, status: 'ready' })
  view.rerender(<LinkPreview link={{ ...link, id: 20 }} scope={2} />)
  expect(await screen.findByText('Current title')).toBeVisible()
  await act(async () => { resolve({ title: 'Old title', image_url: null, status: 'ready' }) })
  expect(screen.queryByText('Old title')).not.toBeInTheDocument()
})


it('loads at most two previews concurrently and eventually processes the remaining cards', async () => {
  const pending: Array<(data: unknown) => void> = []
  api.getLinkPreview.mockImplementation(() => new Promise((done) => { pending.push(done) }))
  const view = render(<>{[101, 102, 103].map((id) => <LinkPreview key={id} link={{ id, url: `https://shop.example/${id}` }} scope={8} />)}</>)
  expect(pending).toHaveLength(2)
  await act(async () => { pending[0]({ title: 'First book', image_url: null, status: 'ready' }) })
  expect(pending).toHaveLength(3)
  await act(async () => { pending[1]({ title: 'Second book', image_url: null, status: 'ready' }); pending[2]({ title: 'Third book', image_url: null, status: 'ready' }) })
  expect(await screen.findByText('Third book')).toBeVisible()
  view.unmount()
})

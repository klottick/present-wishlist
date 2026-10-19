import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ownerItemFixture } from '../../test/fixtures'
import { GiftCard } from './GiftCard'

describe('GiftCard', () => {
  it('does not display the stored price', () => {
    render(<GiftCard item={{ ...ownerItemFixture, price: '$25' }} />)
    expect(screen.queryByText('$25')).not.toBeInTheDocument()
  })

  it('opens only HTTP(S) gift links safely in a new tab', () => {
    const { rerender } = render(<GiftCard item={{ ...ownerItemFixture, link: 'https://shop.example/gift' }} />)
    const link = screen.getByRole('link', { name: 'View gift link' })
    expect(link).toHaveAttribute('href', 'https://shop.example/gift')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')

    rerender(<GiftCard item={{ ...ownerItemFixture, link: 'javascript:alert(1)' }} />)
    expect(screen.queryByRole('link', { name: 'View gift link' })).not.toBeInTheDocument()
  })

  it('renders notes as text, not markup', () => {
    render(<GiftCard item={{ ...ownerItemFixture, notes: '<img src=x onerror=alert(1)>' }} />)

    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeVisible()
    expect(document.querySelector('img')).not.toBeInTheDocument()
  })

  it('shows repeat-purchase allowance on the shared owner card', () => {
    render(<GiftCard item={{ ...ownerItemFixture, allow_multiple_purchases: true }} />)

    expect(screen.getByText('This gift can be purchased by more than one person.')).toBeVisible()
  })
})

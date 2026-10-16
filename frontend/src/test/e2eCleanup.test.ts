import { describe, expect, it } from 'vitest'
import { requiresOwnedGroupCleanup } from '../../e2e/cleanupDecision'

describe('requiresOwnedGroupCleanup', () => {
  it('escalates when the supervisor exits unsuccessfully during the graceful wait', () => {
    expect(requiresOwnedGroupCleanup(1, false)).toBe(true)
  })

  it('escalates when the graceful wait times out', () => {
    expect(requiresOwnedGroupCleanup(null, true)).toBe(true)
  })

  it('does not escalate after a successful graceful exit', () => {
    expect(requiresOwnedGroupCleanup(0, false)).toBe(false)
  })
})

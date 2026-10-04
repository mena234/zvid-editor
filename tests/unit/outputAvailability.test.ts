import { describe, it, expect } from 'vitest'
import { isOutputExpired, outputAvailabilityLabel } from '../../utils/outputAvailability'

describe('output availability', () => {
  it('expires at the deadline even while cleanup is pending', () => {
    const output = { outputExpiresAt: '2026-10-09T12:00:00Z', outputCleanupStatus: 'pending' }
    const deadline = Date.parse(output.outputExpiresAt)
    expect(isOutputExpired(output, deadline - 1)).toBe(false)
    expect(isOutputExpired(output, deadline)).toBe(true)
    expect(outputAvailabilityLabel(output, deadline)).toBe('Output expired')
  })

  it('handles missing metadata and recorded expiration without an invented deadline', () => {
    expect(isOutputExpired({})).toBe(false)
    expect(outputAvailabilityLabel({})).toBe('')
    expect(outputAvailabilityLabel({ outputExpiresAt: 'invalid' })).toBe('')
    expect(isOutputExpired({ outputExpiredAt: '2026-10-09T12:00:00Z' })).toBe(true)
  })
})

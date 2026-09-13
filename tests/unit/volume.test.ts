import { describe, expect, it } from 'vitest'
import { volumeGain, volumePercent } from '../../utils/volume'

describe('volume percentage controls', () => {
  it.each([[0, 0], [0.25, 25], [1, 100], [1.5, 150], [2, 200]])(
    'round-trips gain %s through %s percent',
    (gain, percent) => {
      expect(volumePercent(gain)).toBe(percent)
      expect(volumeGain(percent)).toBe(gain)
    }
  )

  it('keeps default clearing and template gains intact', () => {
    expect(volumePercent(undefined)).toBeUndefined()
    expect(volumeGain(undefined)).toBeUndefined()
    expect(volumePercent('{{gain}}')).toBe('{{gain}}')
    expect(volumeGain('{{gain}}')).toBe('{{gain}}')
  })

  it('bounds numeric input between silence and double gain', () => {
    expect(volumeGain(-10)).toBe(0)
    expect(volumeGain(250)).toBe(2)
  })
})

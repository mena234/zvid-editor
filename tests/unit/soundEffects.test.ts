import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SOUND_EFFECTS, searchSoundEffects } from '../../utils/soundEffects'

describe('bundled sound effects', () => {
  it('ships usable PCM audio whose natural duration matches the library metadata', () => {
    expect(new Set(SOUND_EFFECTS.map((effect) => effect.path)).size).toBe(SOUND_EFFECTS.length)
    for (const effect of SOUND_EFFECTS) {
      const file = readFileSync(new URL(`../../public${effect.path}`, import.meta.url))
      expect(file.toString('ascii', 0, 4)).toBe('RIFF')
      expect(file.toString('ascii', 8, 12)).toBe('WAVE')
      expect(file.readUInt16LE(20)).toBe(1) // PCM
      expect(file.readUInt16LE(34)).toBe(16)
      const sampleCount = file.readUInt32LE(40) / 2
      expect(sampleCount / file.readUInt32LE(24)).toBeCloseTo(effect.duration, 4)
      let peak = 0
      for (let i = 0; i < sampleCount; i++) peak = Math.max(peak, Math.abs(file.readInt16LE(44 + i * 2)))
      expect(peak).toBeGreaterThan(5000) // audible rather than an empty placeholder
      expect(peak).toBeLessThan(32767) // no clipping
      expect(file.readInt16LE(44)).toBe(0)
      expect(file.readInt16LE(file.length - 2)).toBe(0)
    }
  })

  it('finds effects by name and descriptive search terms', () => {
    expect(searchSoundEffects(' SWIPE ').map((effect) => effect.id)).toEqual(['whoosh'])
    expect(searchSoundEffects('bright bell').map((effect) => effect.id)).toEqual(['chime'])
    expect(searchSoundEffects('dog barking')).toEqual([])
    expect(searchSoundEffects('')).toHaveLength(SOUND_EFFECTS.length)
  })
})

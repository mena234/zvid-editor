import {
  mapFilterValue as map,
  mapFilterGain,
  type MediaFilter,
} from './ffmpegFilterGraph'

const byte = (n: number) => Math.min(255, Math.max(0, Math.trunc(n)))
// C lrint uses ties-to-even, unlike JavaScript's Math.round.
export function roundEven(n: number) {
  const lo = Math.floor(n)
  return n - lo === 0.5 ? lo + (lo & 1) : Math.round(n)
}

/** FFmpeg eq's 8-bit integer fast path / high-contrast LUT, not CSS curves. */
export function eqByte(value: number, contrast: number, brightness = 0) {
  if (contrast === 1 && brightness === 0) return value
  if (Math.abs(contrast) >= 7.9)
    return byte(256 * (contrast * (value / 255 - 0.5) + 0.5 + brightness))
  const c = Math.trunc(contrast * 4096)
  const b =
    Math.trunc((Math.trunc(100 * brightness + 100) * 511) / 200) -
    128 -
    Math.trunc(c / 32)
  return byte(((value * c) >> 12) + b)
}

export function gpuFilterSettings(filter: MediaFilter, width: number, height: number) {
  const active = (n: unknown) => Number.isFinite(Number(n)) && Number(n) !== 0
  const brightness = Math.fround(map(filter.brightness ?? 0, -1, 1, -100, 100))
  const contrast = Math.fround(mapFilterGain(filter.contrast))
  const saturate = Math.fround(mapFilterGain(filter.saturate))
  const degrees = parseFloat(String(filter['hue-rotate'] ?? 0)) || 0
  const yuv = [filter.brightness, filter.contrast, filter.saturate, degrees].some(active)
  const invert = filter.invert
    ? map(typeof filter.invert === 'number' ? filter.invert : 1, 0, 1, 0, 1)
    : 0
  let tint = [1, 1, 1]
  if (filter.colorTint) {
    if (!/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(filter.colorTint))
      throw new Error('Invalid tint color')
    const hex =
      filter.colorTint.length === 4
        ? [...filter.colorTint.slice(1)].map((c) => c + c).join('')
        : filter.colorTint.slice(1)
    tint = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  }
  // Upload tiny tables only when settings change. CPU double precision preserves
  // FFmpeg's rounding at extreme contrast and fractional invert/tint values.
  const eq = new Uint8Array(256 * 4),
    rgb = new Uint8Array(256 * 4)
  for (let i = 0; i < 256; i++) {
    eq.set(
      [eqByte(i, contrast, brightness), eqByte(i, saturate), eqByte(i, saturate), 255],
      i * 4
    )
    const inv = invert > 0 ? byte((1 - invert) * i + invert * (255 - i)) : i
    rgb.set([...tint.map((t) => byte(roundEven(inv * t))), 255], i * 4)
  }
  const hue = Math.fround((degrees * Math.PI) / 180)
  const radius = Math.floor(
    Math.min(
      map(filter.blur ?? 0, 0, Math.min(width, height) / 2, 0, 100),
      Math.floor((Math.min(width, height) - 1) / 2)
    )
  )
  return {
    yuv,
    eq,
    rgb,
    radius,
    hue: [roundEven(Math.cos(hue) * 65536), roundEven(Math.sin(hue) * 65536)],
  }
}

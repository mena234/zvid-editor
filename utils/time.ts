export function formatTime(t: number, fps?: number): string {
  if (!isFinite(t)) return '0:00.00'
  const sign = t < 0 ? '-' : ''
  t = Math.abs(t)
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  if (fps) {
    const f = Math.floor((t - Math.floor(t)) * fps)
    return `${sign}${m}:${String(s).padStart(2, '0')}.${String(f).padStart(2, '0')}`
  }
  const cs = Math.floor((t - Math.floor(t)) * 100)
  return `${sign}${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

export function formatTimeShort(t: number): string {
  const m = Math.floor(t / 60)
  const s = t % 60
  if (m === 0) return `${trimNum(s)}s`
  return `${m}:${String(Math.floor(s)).padStart(2, '0')}`
}

export function trimNum(v: number, decimals = 2): string {
  return String(Math.round(v * 10 ** decimals) / 10 ** decimals)
}

export function round3(v: number): number {
  return Math.round(v * 1000) / 1000
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

/** Adaptive ruler tick spacing for a given px/sec zoom. */
export function pickTickStep(pxPerSec: number): { major: number; minor: number } {
  const candidates = [
    0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300,
  ]
  for (const c of candidates) {
    if (c * pxPerSec >= 70) return { major: c, minor: c / 5 }
  }
  return { major: 600, minor: 120 }
}

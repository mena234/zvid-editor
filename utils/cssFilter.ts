/**
 * Approximate the package's FFmpeg style filters (getStyleFilters.ts) with
 * CSS filter() for the stage preview. The FFmpeg curves are not identical
 * (contrast maps 0..100 → 1..1000(!), saturation 0..100 → 1..3); we use
 * perceptually similar CSS mappings and label the preview as approximate.
 */
export interface ZvidFilter {
  brightness?: number // -100..100
  contrast?: number // -100..100
  saturate?: number // -100..100
  'hue-rotate'?: string | number
  blur?: string | number // 0..100 (% of shortest dim / 2)
  invert?: boolean | number
  colorTint?: string
}

export function filterToCss(
  filter: ZvidFilter | undefined,
  itemWidth: number,
  itemHeight: number
): string {
  if (!filter) return ''
  const parts: string[] = []

  if (filter.brightness !== undefined && filter.brightness !== 0) {
    // FFmpeg eq brightness is additive (-1..1); CSS brightness is multiplicative.
    parts.push(`brightness(${1 + filter.brightness / 100})`)
  }
  if (filter.contrast !== undefined && filter.contrast !== 0) {
    const c = filter.contrast
    parts.push(`contrast(${c < 0 ? 1 + c / 100 : 1 + (c / 100) * 2})`)
  }
  if (filter.saturate !== undefined && filter.saturate !== 0) {
    const s = filter.saturate
    parts.push(`saturate(${s < 0 ? 1 + s / 100 : 1 + (s / 100) * 2})`)
  }
  const hue = filter['hue-rotate']
  if (hue !== undefined && hue !== 0 && hue !== '0') {
    const deg = parseFloat(String(hue))
    if (!Number.isNaN(deg) && deg !== 0) parts.push(`hue-rotate(${deg}deg)`)
  }
  if (filter.blur !== undefined && Number(filter.blur) !== 0) {
    const pct = Number(filter.blur)
    if (!Number.isNaN(pct)) {
      const shortest = Math.min(itemWidth || 100, itemHeight || 100) / 2
      // preview at a fraction of the true radius — full FFmpeg boxblur radius
      // makes the DOM preview unusably smeared; keep it representative
      const radius = ((pct / 100) * shortest) / 4
      parts.push(`blur(${Math.min(radius, 60)}px)`)
    }
  }
  if (filter.invert) {
    const v = typeof filter.invert === 'number' ? filter.invert : 1
    parts.push(`invert(${Math.min(1, Math.max(0, v))})`)
  }
  return parts.join(' ')
}

/** colorTint multiplies channels — approximated with a multiply overlay. */
export function tintOverlayColor(filter: ZvidFilter | undefined): string | null {
  if (!filter?.colorTint) return null
  return filter.colorTint
}

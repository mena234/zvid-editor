/**
 * Browser counterpart of package/src/lib/videos/filters/getStyleFilters.ts.
 * These are FFmpeg instructions, not a CSS approximation. The fidelity suite
 * compares this graph with the package's real graph and renders both engines.
 */
export interface MediaFilter {
  brightness?: number | string
  contrast?: number | string
  saturate?: number | string
  'hue-rotate'?: string | number
  blur?: string | number
  invert?: boolean | number
  colorTint?: string
}

// Same clamping and four-decimal rounding as package/utils/calcRangeMap.
function map(value: unknown, min: number, max: number, lo: number, hi: number) {
  const n = Number(value)
  if (!Number.isFinite(n)) return min
  return +Math.min(
    max,
    Math.max(min, min + ((n - lo) / (hi - lo)) * (max - min))
  ).toFixed(4)
}

export { map as mapFilterValue }

/** Gradual contrast/saturation: -100..0 -> 0..1; 0..100 -> 1..3.
 * Shared by the GPU, FFmpeg graph and legacy SVG parameter mapping.
 * Native counterpart: package/src/lib/videos/filters/getStyleFilters.ts.
 */
export function mapFilterGain(value: unknown) {
  return Number(value) < 0 ? map(value, 0, 1, -100, 0) : map(value ?? 0, 1, 3, 0, 100)
}

export function hasMediaFilter(filter?: MediaFilter): boolean {
  if (!filter) return false
  return (
    ['brightness', 'contrast', 'saturate', 'blur'].some((key) => {
      const n = Number(filter[key as keyof MediaFilter])
      return Number.isFinite(n) && n !== 0
    }) ||
    (Number.isFinite(parseFloat(String(filter['hue-rotate']))) &&
      parseFloat(String(filter['hue-rotate'])) !== 0) ||
    !!filter.invert ||
    !!filter.colorTint
  )
}

export function mediaFilterGraph(filter: MediaFilter, width: number, height: number) {
  if (!hasMediaFilter(filter)) return { graph: '', output: '0:v' }
  const nodes = [
    '[0:v]format=rgba[fmt_0]',
    '[fmt_0]split=2[col_0][a_0]',
    '[a_0]alphaextract[ap_0]',
  ]
  let current = 'col_0'
  function add(name: string, options: string, output: string) {
    nodes.push(`[${current}]${name}${options ? `=${options}` : ''}[${output}]`)
    current = output
  }
  const eq: string[] = []
  if (filter.brightness !== undefined && Number(filter.brightness) !== 0)
    eq.push(`brightness=${map(filter.brightness, -1, 1, -100, 100)}`)
  const contrast = Number(filter.contrast)
  if (Number.isFinite(contrast) && contrast !== 0)
    eq.push(`contrast=${mapFilterGain(contrast)}`)
  const saturate = Number(filter.saturate)
  if (Number.isFinite(saturate) && saturate !== 0)
    eq.push(`saturation=${mapFilterGain(saturate)}`)
  if (eq.length) add('eq', eq.join(':'), 'eq_0')
  const hue = parseFloat(String(filter['hue-rotate']))
  if (Number.isFinite(hue) && hue !== 0) add('hue', `h=${hue}`, 'hue_0')
  if (filter.blur !== undefined && Number(filter.blur) !== 0) {
    const radius = map(filter.blur, 0, Math.min(width, height) / 2, 0, 100)
    // FFmpeg's boxblur reads src[2*radius] at its mirrored boundary. Keep it
    // within each plane, including subsampled chroma, even at blur=100.
    add(
      'boxblur',
      `luma_radius='min(${radius},floor((min(w,h)-1)/2))':chroma_radius='min(${radius},floor((min(cw,ch)-1)/2))'`,
      'blur_0'
    )
  }
  if (filter.invert) {
    const strength = map(
      typeof filter.invert === 'number' ? filter.invert : 1,
      0,
      1,
      0,
      1
    )
    if (strength >= 1) {
      // Match partial inversion's RGB space at the full-strength endpoint.
      add('format', 'rgba', 'invert_rgb_0')
      add('negate', '', 'invert_0')
    } else if (strength > 0)
      add(
        'lutrgb',
        ['r', 'g', 'b']
          .map((c) => `${c}='(1-${strength})*val+${strength}*(255-val)'`)
          .join(':'),
        'invert_0'
      )
    else add('copy', '', 'invert_0')
  }
  if (filter.colorTint) {
    const raw = filter.colorTint
    if (!/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(raw)) throw new Error('Invalid tint color')
    const hex =
      raw.length === 4 ? '#' + [...raw.slice(1)].map((c) => c + c).join('') : raw
    add(
      'colorchannelmixer',
      ['rr', 'gg', 'bb']
        .map((c, i) => `${c}=${parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255}`)
        .join(':'),
      'tint_0'
    )
  }
  nodes.push(`[${current}][ap_0]alphamerge[styled_0]`)
  return { graph: nodes.join(';'), output: 'styled_0' }
}

export function mediaFilterArgs(filter: MediaFilter, width: number, height: number) {
  const { graph, output } = mediaFilterGraph(filter, width, height)
  return [
    '-v',
    'error',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgba',
    '-s',
    `${width}x${height}`,
    '-i',
    'input.rgba',
    ...(graph ? ['-filter_complex', graph, '-map', `[${output}]`] : ['-map', output]),
    '-frames:v',
    '1',
    '-pix_fmt',
    'rgba',
    '-f',
    'rawvideo',
    'output.rgba',
  ]
}

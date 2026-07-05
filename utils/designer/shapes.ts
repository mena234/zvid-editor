import type { ShapeLayer } from './types'
import { paintAccent, paintCss } from './types'
import { EXTRA_SHAPES } from './shapes-extra'

/**
 * Shape & icon registry for the Design Studio.
 *
 * Two flavours:
 *  - css: a plain <div class="dz-s"> styled with background/border/radius
 *  - svg: inline <svg> markup (fill or stroke driven) — no external
 *    resources, so it passes the package's customCode sanitizer untouched.
 *
 * The bulk of the library (200+ shapes) lives in `shapes-extra.ts`; this
 * module owns the registry, the picker groups and the compile helpers.
 */

export type ShapeGroup =
  | 'Basic'
  | 'Geometry'
  | 'Stars & Bursts'
  | 'Arrows'
  | 'Callouts'
  | 'Badges & Banners'
  | 'Nature'
  | 'Symbols'
  | 'Icons'
  | 'Frames'
  | 'Lines & Decor'

export interface ShapePaintCtx {
  /** svg fill attribute value (color or url(#gradient-id)) */
  fill: string
  /** accent color (gradients fall back to their `from` stop) */
  accent: string
  strokeWidth: number
}

export interface ShapeDef {
  label: string
  group: ShapeGroup
  kind: 'css' | 'svg'
  /** natural aspect ratio (w/h) used when inserting */
  ratio?: number
  /** css kind: extra declarations for .dz-s (background/border handled by compiler) */
  css?: (l: ShapeLayer) => string
  /** svg kind: inner markup */
  svg?: (viewW: number, viewH: number, p: ShapePaintCtx) => string
  viewBox?: [number, number]
  /** svg shapes drawn with strokes instead of fills */
  strokeBased?: boolean
}

const fillPath = (d: string) => (_w: number, _h: number, p: ShapePaintCtx) =>
  `<path d="${d}" fill="${p.fill}"/>`

const strokePath =
  (d: string, extra = '') =>
  (_w: number, _h: number, p: ShapePaintCtx) =>
    `<path d="${d}" stroke="${p.accent}" stroke-width="${p.strokeWidth}" fill="none" stroke-linecap="round" stroke-linejoin="round"${extra}/>`

export const SHAPES: Record<string, ShapeDef> = {
  /* ---------------- Basic (css) ---------------- */
  rect: {
    label: 'Rectangle',
    group: 'Basic',
    kind: 'css',
    ratio: 1.5,
    css: (l) => `border-radius: ${l.radius}px;`,
  },
  pill: {
    label: 'Pill',
    group: 'Basic',
    kind: 'css',
    ratio: 2.6,
    css: () => 'border-radius: 999px;',
  },
  circle: {
    label: 'Circle',
    group: 'Basic',
    kind: 'css',
    ratio: 1,
    css: () => 'border-radius: 50%;',
  },
  ring: {
    label: 'Ring',
    group: 'Basic',
    kind: 'css',
    ratio: 1,
    css: (l) =>
      `border-radius: 50%; background: transparent; border: ${l.strokeWidth}px solid ${paintAccent(l.fill)};`,
  },
  bar: {
    label: 'Bar',
    group: 'Basic',
    kind: 'css',
    ratio: 10,
    css: (l) => `border-radius: ${l.radius}px;`,
  },

  /* ---------------- classic svg shapes ---------------- */
  triangle: {
    label: 'Triangle',
    group: 'Geometry',
    kind: 'svg',
    viewBox: [300, 300],
    ratio: 1,
    svg: fillPath('M150 22L282 272H18z'),
  },
  diamond: {
    label: 'Diamond',
    group: 'Geometry',
    kind: 'svg',
    viewBox: [300, 300],
    ratio: 1,
    svg: fillPath('M150 15L285 150 150 285 15 150z'),
  },
  star: {
    label: 'Star',
    group: 'Stars & Bursts',
    kind: 'svg',
    viewBox: [300, 300],
    ratio: 1,
    svg: fillPath('M150 15l41 84 93 13-67 66 16 92-83-44-83 44 16-92-67-66 93-13z'),
  },
  burst: {
    label: 'Burst',
    group: 'Stars & Bursts',
    kind: 'svg',
    viewBox: [300, 300],
    ratio: 1,
    svg: fillPath(
      'M150 10l25 55 50-33-8 60 60-8-33 50 55 25-55 25 33 50-60-8 8 60-50-33-25 55-25-55-50 33 8-60-60 8 33-50-55-25 55-25-33-50 60 8-8-60 50 33z'
    ),
  },
  heart: {
    label: 'Heart',
    group: 'Symbols',
    kind: 'svg',
    viewBox: [300, 280],
    ratio: 300 / 280,
    svg: fillPath(
      'M150 266C150 266 28 186 28 102 28 54 66 22 106 22c20 0 37 9 44 24 7-15 24-24 44-24 40 0 78 32 78 80 0 84-122 164-122 164z'
    ),
  },
  blob: {
    label: 'Blob',
    group: 'Geometry',
    kind: 'svg',
    viewBox: [300, 300],
    ratio: 1,
    svg: fillPath(
      'M62 84c26-45 92-64 138-40s62 82 40 130-84 74-132 52S36 129 62 84z'
    ),
  },
  bolt: {
    label: 'Lightning',
    group: 'Nature',
    kind: 'svg',
    viewBox: [240, 300],
    ratio: 240 / 300,
    svg: fillPath('M138 10L28 170h62l-24 120L212 120h-72z'),
  },
  hexagon: {
    label: 'Hexagon',
    group: 'Geometry',
    kind: 'svg',
    viewBox: [300, 300],
    ratio: 1,
    svg: fillPath('M150 12l120 69v138l-120 69-120-69V81z'),
  },
  bubble: {
    label: 'Speech bubble',
    group: 'Callouts',
    kind: 'svg',
    viewBox: [300, 250],
    ratio: 300 / 250,
    svg: fillPath(
      'M48 26h204a26 26 0 0 1 26 26v112a26 26 0 0 1-26 26H136l-58 56 14-56H48a26 26 0 0 1-26-26V52a26 26 0 0 1 26-26z'
    ),
  },
  badge: {
    label: 'Badge',
    group: 'Badges & Banners',
    kind: 'svg',
    viewBox: [300, 300],
    ratio: 1,
    // scalloped seal: 12-lobe rosette
    svg: (_w, _h, p) => {
      const pts: string[] = []
      const lobes = 12
      for (let i = 0; i < lobes * 2; i++) {
        const r = i % 2 === 0 ? 140 : 118
        const a = (i / (lobes * 2)) * Math.PI * 2 - Math.PI / 2
        pts.push(`${(150 + Math.cos(a) * r).toFixed(1)} ${(150 + Math.sin(a) * r).toFixed(1)}`)
      }
      return `<polygon points="${pts.join(',')}" fill="${p.fill}"/>`
    },
  },

  /* ---------------- classic icons (svg fill, 24 viewBox) ---------------- */
  sparkle: {
    label: 'Sparkle',
    group: 'Icons',
    kind: 'svg',
    viewBox: [24, 24],
    ratio: 1,
    svg: fillPath('M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z'),
  },
  'sparkle-sm': {
    label: 'Twinkle',
    group: 'Icons',
    kind: 'svg',
    viewBox: [24, 24],
    ratio: 1,
    svg: fillPath(
      'M12 3l1.8 5.7L19.5 10.5l-5.7 1.8L12 18l-1.8-5.7L4.5 10.5l5.7-1.8zM19 15l.9 2.6L22.5 18.5l-2.6.9L19 22l-.9-2.6L15.5 18.5l2.6-.9z'
    ),
  },
  crown: {
    label: 'Crown',
    group: 'Badges & Banners',
    kind: 'svg',
    viewBox: [24, 24],
    ratio: 1,
    svg: fillPath('M3 17l-1.2-9.5 5.7 3.6L12 4l4.5 7.1 5.7-3.6L21 17zM3.5 19h17v2h-17z'),
  },
  moon: {
    label: 'Moon',
    group: 'Nature',
    kind: 'svg',
    viewBox: [24, 24],
    ratio: 1,
    svg: fillPath('M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z'),
  },
  play: {
    label: 'Play',
    group: 'Icons',
    kind: 'svg',
    viewBox: [24, 24],
    ratio: 1,
    svg: fillPath('M8 5v14l11-7z'),
  },
  note: {
    label: 'Music note',
    group: 'Icons',
    kind: 'svg',
    viewBox: [24, 24],
    ratio: 1,
    svg: fillPath('M13 3v10.6a3.5 3.5 0 1 1-2-3.2V3h2zM19 4v6.6a3.5 3.5 0 1 1-2-3.2V4h2z'),
  },
  magic: {
    label: 'Magic',
    group: 'Icons',
    kind: 'svg',
    viewBox: [24, 24],
    ratio: 1,
    svg: fillPath(
      'M15.5 3l1 2.5L19 6.5l-2.5 1-1 2.5-1-2.5L12 6.5l2.5-1zM8 7l1.3 3.2 3.2 1.3-3.2 1.3L8 16l-1.3-3.2L3.5 11.5l3.2-1.3zM17 13l.9 2.1 2.1.9-2.1.9L17 19l-.9-2.1L14 16l2.1-.9z'
    ),
  },

  /* ---------------- classic decor ---------------- */
  check: {
    label: 'Check',
    group: 'Symbols',
    kind: 'svg',
    viewBox: [300, 300],
    ratio: 1,
    strokeBased: true,
    svg: strokePath('M42 160l72 72 144-150'),
  },
  arrow: {
    label: 'Arrow',
    group: 'Arrows',
    kind: 'svg',
    viewBox: [400, 120],
    ratio: 400 / 120,
    strokeBased: true,
    svg: strokePath('M10 60h300M310 60l-70-45M310 60l-70 45'),
  },
  squiggle: {
    label: 'Squiggle',
    group: 'Lines & Decor',
    kind: 'svg',
    viewBox: [300, 60],
    ratio: 5,
    strokeBased: true,
    svg: strokePath('M8 38q30-28 60 0t60 0 60 0 60 0q15-14 44-10'),
  },
  'dashed-ring': {
    label: 'Dashed ring',
    group: 'Frames',
    kind: 'svg',
    viewBox: [300, 300],
    ratio: 1,
    strokeBased: true,
    svg: (_w, _h, p) =>
      `<circle cx="150" cy="150" r="132" stroke="${p.accent}" stroke-width="${p.strokeWidth}" fill="none" stroke-linecap="round" stroke-dasharray="28 22"/>`,
  },
  sunburst: {
    label: 'Sunburst',
    group: 'Stars & Bursts',
    kind: 'svg',
    viewBox: [300, 300],
    ratio: 1,
    svg: (_w, _h, p) => {
      // 12 tapered rays around the center
      const rays: string[] = []
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * 360
        rays.push(
          `<path d="M150 150L140 34 A118 118 0 0 1 160 34z" fill="${p.fill}" transform="rotate(${a} 150 150)"/>`
        )
      }
      return rays.join('')
    },
  },
  dots: {
    label: 'Dot grid',
    group: 'Lines & Decor',
    kind: 'svg',
    viewBox: [300, 180],
    ratio: 300 / 180,
    svg: (_w, _h, p) => {
      const dots: string[] = []
      for (let r = 0; r < 4; r++)
        for (let c = 0; c < 7; c++)
          dots.push(`<circle cx="${24 + c * 42}" cy="${24 + r * 44}" r="9" fill="${p.fill}"/>`)
      return dots.join('')
    },
  },
  confetti: {
    label: 'Confetti',
    group: 'Lines & Decor',
    kind: 'svg',
    viewBox: [300, 300],
    ratio: 1,
    svg: (_w, _h, p) => {
      // deterministic scatter of ticks/dots in the layer's accent color
      const bits = [
        [40, 50, 30], [110, 24, -20], [200, 40, 15], [268, 70, 40],
        [60, 140, -35], [250, 150, -10], [30, 230, 20], [150, 260, -25],
        [230, 240, 35], [170, 120, 8],
      ]
      const parts = bits.map(
        ([x, y, r]) =>
          `<rect x="${x}" y="${y}" width="10" height="26" rx="5" fill="${p.fill}" transform="rotate(${r} ${x} ${y})"/>`
      )
      parts.push(`<circle cx="90" cy="90" r="8" fill="${p.accent}"/>`)
      parts.push(`<circle cx="215" cy="195" r="7" fill="${p.accent}"/>`)
      parts.push(`<circle cx="120" cy="205" r="6" fill="${p.accent}"/>`)
      return parts.join('')
    },
  },

  ...EXTRA_SHAPES,
}

export const SHAPE_GROUPS: readonly ShapeGroup[] = [
  'Basic',
  'Geometry',
  'Stars & Bursts',
  'Arrows',
  'Callouts',
  'Badges & Banners',
  'Nature',
  'Symbols',
  'Icons',
  'Frames',
  'Lines & Decor',
] as const

export function shapeDef(key: string): ShapeDef {
  return SHAPES[key] ?? SHAPES.rect
}

/** Small standalone <svg> preview (solid accent paint) for pickers. */
export function shapePreviewSvg(key: string, color = 'currentColor'): string {
  const def = shapeDef(key)
  if (def.kind === 'css') {
    const radius =
      key === 'circle' || key === 'ring' ? '50%' : key === 'pill' ? '999px' : '3px'
    const border = key === 'ring' ? `border: 3px solid ${color}; background: none;` : ''
    const size =
      key === 'bar' ? 'width: 30px; height: 8px;' : key === 'pill' ? 'width: 30px; height: 14px;' : 'width: 22px; height: 22px;'
    return `<span style="display:inline-block;${size}background:${color};${border}border-radius:${radius}"></span>`
  }
  const [vw, vh] = def.viewBox ?? [24, 24]
  const inner = def.svg!(vw, vh, { fill: color, accent: color, strokeWidth: Math.max(8, vw / 14) })
  return `<svg viewBox="0 0 ${vw} ${vh}" width="24" height="24" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`
}

/** Compile-time svg markup for a shape layer (gradient-aware). */
export function shapeSvgMarkup(l: ShapeLayer, gradientId: string): string {
  const def = shapeDef(l.shape)
  if (def.kind !== 'svg') return ''
  const [vw, vh] = def.viewBox ?? [24, 24]
  const useGradient = l.fill.kind === 'gradient' && !def.strokeBased
  const defs = useGradient
    ? `<defs><linearGradient id="${gradientId}" gradientTransform="rotate(${(l.fill as any).angle - 90} 0.5 0.5)"><stop offset="0" stop-color="${(l.fill as any).from}"/><stop offset="1" stop-color="${(l.fill as any).to}"/></linearGradient></defs>`
    : ''
  const paint: ShapePaintCtx = {
    fill: useGradient ? `url(#${gradientId})` : paintAccent(l.fill),
    accent: paintAccent(l.fill),
    strokeWidth: l.strokeWidth,
  }
  return `<svg class="dz-s" viewBox="0 0 ${vw} ${vh}" width="${l.width}" height="${l.height}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">${defs}${def.svg!(vw, vh, paint)}</svg>`
}

/** Compile-time css for a css-kind shape layer's .dz-s box. */
export function shapeCssDecls(l: ShapeLayer): string {
  const def = shapeDef(l.shape)
  if (def.kind !== 'css') return ''
  const base = `width: ${l.width}px; height: ${l.height}px; background: ${paintCss(l.fill)};`
  return `${base} ${def.css?.(l) ?? ''}`
}

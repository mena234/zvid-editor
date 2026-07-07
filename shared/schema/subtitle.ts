import type { RawCaption, RawSubtitle, RawSubtitleStyles, RawWord } from './types'

/**
 * Subtitle schema conversion: the wire format is the simplified v2 shape
 * (flat `animation`/`font`/`stroke`/`background`/`position`/`margin` keys,
 * `src` or `captions`), while the editor keeps working on the internal
 * `{ captions, styles }` model that the preview runtime and panel use.
 * Mirrors package/src/lib/subtitles/normalizeSubtitle.ts — keep in lockstep.
 */

export const SUBTITLE_V2_STYLE_KEYS = [
  'animation',
  'direction',
  'font',
  'stroke',
  'background',
  'activeWord',
  'position',
  'margin',
] as const

/**
 * Distribute word timings across a caption window proportionally to word
 * length (+1 for the trailing space). Canonical copy — the package mirrors it.
 */
export function distributeWords(text: string, start: number, end: number): RawWord[] {
  const parts = String(text ?? '')
    .split(/\s+/)
    .filter(Boolean)
  if (!parts.length || !(end > start)) return []
  const total = end - start
  const weightSum = parts.reduce((s, w) => s + w.length + 1, 0)
  let t = start
  return parts.map((w) => {
    const dur = ((w.length + 1) / weightSum) * total
    const word = {
      start: Math.round(t * 1000) / 1000,
      end: Math.round((t + dur) * 1000) / 1000,
      text: w,
    }
    t += dur
    return word
  })
}

/** Split captions so no group exceeds `maxWords`; chunks display contiguously. */
export function chunkCaptions(captions: RawCaption[], maxWords: number): RawCaption[] {
  const limit = Math.max(1, Math.floor(maxWords))
  const out: RawCaption[] = []
  for (const caption of captions) {
    const words = caption.words ?? []
    if (words.length <= limit) {
      out.push(caption)
      continue
    }
    const groups: RawWord[][] = []
    for (let i = 0; i < words.length; i += limit) {
      groups.push(words.slice(i, i + limit))
    }
    groups.forEach((group, i) => {
      out.push({
        start: i === 0 ? caption.start : group[0].start,
        end: i === groups.length - 1 ? caption.end : groups[i + 1][0].start,
        text: group.map((w) => w.text).join(' '),
        words: group,
      })
    })
  }
  return out
}

/** Fold a 0–1 opacity into a hex color's alpha channel (#rrggbbaa). */
export function applyOpacityToHex(color: string, opacity?: number): string {
  if (opacity == null) return color
  let value = String(color).trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]{3,8}$/.test(value)) value = 'ffffff'
  if (value.length === 3 || value.length === 4) {
    value = value
      .split('')
      .map((c) => c + c)
      .join('')
  }
  const baseAlpha = value.length === 8 ? parseInt(value.slice(6, 8), 16) : 255
  const clamped = Math.min(1, Math.max(0, opacity))
  const alpha = Math.round(baseAlpha * clamped)
  return `#${value.slice(0, 6)}${alpha.toString(16).padStart(2, '0')}`
}

function expandPosition(pos: string): string {
  return pos === 'top' || pos === 'center' || pos === 'bottom' ? `${pos}-center` : pos
}

function ensureWords(captions: RawCaption[]): RawCaption[] {
  return captions.map((c) => {
    if (c.words?.length) return c
    // template-var timings ("{{start}}") resolve at render time — the package
    // normalizer distributes words then; keep the caption untouched here
    if (typeof c.start !== 'number' || typeof c.end !== 'number') return c
    const words = distributeWords(c.text ?? '', c.start, c.end)
    return words.length ? { ...c, words } : c
  })
}

/**
 * Convert an incoming subtitle (legacy `{captions, styles}` or flat v2) into
 * the editor's internal `{captions, styles, src?}` model. `maxWordsPerLine`
 * is applied to the captions right away so the preview matches the render.
 */
export function importSubtitle(raw: Record<string, any> | undefined): RawSubtitle | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const {
    src,
    captions = [],
    styles,
    animation,
    direction,
    font,
    stroke,
    background,
    activeWord,
    position,
    margin,
    maxWordsPerLine,
    ...rest
  } = raw

  let caps: RawCaption[] = ensureWords(captions as RawCaption[])
  if (maxWordsPerLine != null && Number.isFinite(Number(maxWordsPerLine))) {
    caps = chunkCaptions(caps, Number(maxWordsPerLine))
  }

  let st: RawSubtitleStyles | undefined
  if (styles !== undefined) {
    st = styles as RawSubtitleStyles
  } else {
    const s: Record<string, any> = {}
    if (font && typeof font === 'object') {
      if (font.color != null) s.color = font.color
      if (font.size != null) s.fontSize = font.size
      if (font.family != null) s.fontFamily = font.family
      if (font.bold != null) s.isBold = font.bold
      if (font.italic != null) s.isItalic = font.italic
      if (font.transform != null) s.textTransform = font.transform
    }
    if (stroke && typeof stroke === 'object') {
      s.outline = { width: stroke.width, color: stroke.color }
    }
    if (background && typeof background === 'object') {
      if (background.color != null || background.opacity != null) {
        s.background = applyOpacityToHex(background.color ?? '#000000', background.opacity)
      }
      if (background.padding != null) s.backgroundPadding = background.padding
      if (background.radius != null) s.backgroundRadius = background.radius
    }
    if (activeWord && typeof activeWord === 'object') s.activeWord = { ...activeWord }
    if (position != null) s.position = expandPosition(String(position))
    if (margin && typeof margin === 'object') {
      if (margin.x != null) s.marginH = margin.x
      if (margin.y != null) s.marginV = margin.y
    }
    if (animation != null) s.mode = animation
    if (direction != null) s.slideDirection = direction
    st = Object.keys(s).length ? (s as RawSubtitleStyles) : undefined
  }

  const out: Record<string, any> = { ...rest, captions: caps }
  if (st) out.styles = st
  if (src) out.src = src
  return out as RawSubtitle
}

/**
 * Serialize the internal subtitle model to the simplified v2 wire shape.
 * Positions that merely restate the bottom-center default are dropped, and
 * `*-center` positions collapse to the `top`/`center`/`bottom` shorthands.
 */
export function exportSubtitle(sub: RawSubtitle): Record<string, any> {
  const out: Record<string, any> = {}

  if ((sub as any).src && !sub.captions?.length) {
    out.src = (sub as any).src
  } else {
    out.captions = (sub.captions ?? []).map((c) => {
      const cap: Record<string, any> = { start: c.start, end: c.end }
      if (c.text !== undefined) cap.text = c.text
      if (c.words?.length) {
        cap.words = c.words.map((w) => ({ start: w.start, end: w.end, text: w.text }))
      }
      for (const k of Object.keys(c)) if (!(k in cap) && k !== 'words') cap[k] = (c as any)[k]
      return cap
    })
  }

  const st: Record<string, any> = (sub.styles as any) ?? {}
  if (st.mode !== undefined) out.animation = st.mode
  if (st.slideDirection !== undefined) out.direction = st.slideDirection

  const font: Record<string, any> = {}
  if (st.fontFamily !== undefined) font.family = st.fontFamily
  if (st.fontSize !== undefined) font.size = st.fontSize
  if (st.color !== undefined) font.color = st.color
  if (st.isBold !== undefined) font.bold = st.isBold
  if (st.isItalic !== undefined) font.italic = st.isItalic
  if (st.textTransform !== undefined) font.transform = st.textTransform
  if (Object.keys(font).length) out.font = font

  if (st.outline) out.stroke = { color: st.outline.color, width: st.outline.width }

  const background: Record<string, any> = {}
  if (st.background !== undefined) background.color = st.background
  if (st.backgroundPadding !== undefined) background.padding = st.backgroundPadding
  if (st.backgroundRadius !== undefined) background.radius = st.backgroundRadius
  if (Object.keys(background).length) out.background = background

  if (st.activeWord && Object.keys(st.activeWord).length) {
    out.activeWord = { ...st.activeWord }
  }

  if (st.position) {
    // '*-center' collapses to the 'top'/'center'/'bottom' shorthand; kept
    // explicit (even for the bottom default) so re-imports round-trip exactly
    out.position = String(st.position).endsWith('-center')
      ? String(st.position).replace('-center', '')
      : st.position
  }

  const margin: Record<string, any> = {}
  if (st.marginH !== undefined) margin.x = st.marginH
  if (st.marginV !== undefined) margin.y = st.marginV
  if (Object.keys(margin).length) out.margin = margin

  // Unknown style keys (hand-edited files) can't ride along in v2 — the API
  // rejects mixing `styles` with the flat keys — so fall back to exporting
  // the legacy shape wholesale rather than silently dropping anything.
  const known = new Set([
    'mode',
    'slideDirection',
    'fontFamily',
    'fontSize',
    'color',
    'isBold',
    'isItalic',
    'textTransform',
    'outline',
    'background',
    'backgroundPadding',
    'backgroundRadius',
    'activeWord',
    'position',
    'marginH',
    'marginV',
  ])
  if (Object.keys(st).some((k) => !known.has(k))) {
    const legacy: Record<string, any> = {}
    if (out.src) legacy.src = out.src
    else legacy.captions = out.captions
    legacy.styles = st
    return legacy
  }

  return out
}

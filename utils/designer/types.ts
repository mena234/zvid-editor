/**
 * Design Studio document model.
 *
 * A DesignDoc is the visual-editor source for a TEXT element: layers of
 * text / shapes / images over an optional background, each with styling and
 * one animation preset. `compileDesign()` turns it into `html` +
 * `customCode.css` that render identically on the stage preview and in the
 * package's Puppeteer capture (CSS-only — no JS, no external resources).
 *
 * The doc itself is stored on the item under `designer` (schemas are
 * passthrough, export keeps unknown fields) so designs stay re-editable
 * after export/import round-trips.
 */

export interface GradientPaint {
  kind: 'gradient'
  from: string
  to: string
  /** degrees, CSS linear-gradient convention */
  angle: number
}

export interface SolidPaint {
  kind: 'solid'
  color: string
}

export type Paint = SolidPaint | GradientPaint

export interface LayerAnim {
  /** preset id from animations.ts */
  preset: string
  /** seconds — one run for entrances, one period for loops */
  duration: number
  /** seconds before the animation starts */
  delay: number
  /** seconds between letters/words (split text presets only) */
  stagger: number
  /** easing id (entrance presets only) */
  easing: string
  /** slide/wipe direction */
  dir: 'up' | 'down' | 'left' | 'right'
}

interface LayerBase {
  id: string
  name: string
  hidden?: boolean
  /** center position, % of canvas (can go slightly outside 0..100) */
  x: number
  y: number
  /** static transform, applied to the layer wrapper */
  rotate: number
  scale: number
  opacity: number
  anim: LayerAnim | null
}

export interface TextLayer extends LayerBase {
  kind: 'text'
  text: string
  fontSize: number
  fontWeight: string
  /** em */
  letterSpacing: number
  lineHeight: number
  align: 'left' | 'center' | 'right'
  textTransform: '' | 'uppercase' | 'lowercase' | 'capitalize'
  fill: Paint
  /** wrap width in px; undefined = hug content */
  width?: number
  stroke?: { width: number; color: string }
  shadow?: { x: number; y: number; blur: number; color: string }
  /** highlight pill behind the text */
  pill?: { color: string; padX: number; padY: number; radius: number }
}

export interface ShapeLayer extends LayerBase {
  kind: 'shape'
  /** key into SHAPES registry */
  shape: string
  width: number
  height: number
  fill: Paint
  /** ring thickness / svg stroke width / css border */
  strokeWidth: number
  /** css rect corner radius */
  radius: number
}

export interface ImageLayer extends LayerBase {
  kind: 'image'
  src: string
  width: number
  height: number
  radius: number
  fit: 'cover' | 'contain' | 'fill'
}

export type DesignLayer = TextLayer | ShapeLayer | ImageLayer

export interface DesignBackground {
  kind: 'none' | 'solid' | 'gradient'
  color: string
  from: string
  to: string
  angle: number
  radius: number
}

export interface DesignDoc {
  version: 1
  width: number
  height: number
  background: DesignBackground
  /** single Google Font for the whole design (maps to item style.fontFamily) */
  fontFamily: string
  /** loop duration in seconds; 'auto' derives it from the animations */
  duration: number | 'auto'
  /** bottom → top */
  layers: DesignLayer[]
}

/* ------------------------------------------------------------------ */
/* factories                                                           */
/* ------------------------------------------------------------------ */

let n = 0
export function makeLayerId(): string {
  n += 1
  return `dl_${Date.now().toString(36)}${n.toString(36)}${Math.random().toString(36).slice(2, 5)}`
}

export function makeDesign(partial?: Partial<DesignDoc>): DesignDoc {
  return {
    version: 1,
    width: 800,
    height: 450,
    background: { kind: 'none', color: '#101321', from: '#1b2340', to: '#0c0f1c', angle: 135, radius: 0 },
    fontFamily: 'Poppins',
    duration: 'auto',
    layers: [],
    ...partial,
  }
}

export function makeTextLayer(partial?: Partial<TextLayer>): TextLayer {
  return {
    id: makeLayerId(),
    kind: 'text',
    name: 'Text',
    x: 50,
    y: 50,
    rotate: 0,
    scale: 1,
    opacity: 1,
    anim: null,
    text: 'Your text',
    fontSize: 64,
    fontWeight: '700',
    letterSpacing: 0,
    lineHeight: 1.15,
    align: 'center',
    textTransform: '',
    fill: { kind: 'solid', color: '#ffffff' },
    ...partial,
  }
}

export function makeShapeLayer(partial?: Partial<ShapeLayer>): ShapeLayer {
  return {
    id: makeLayerId(),
    kind: 'shape',
    name: 'Shape',
    x: 50,
    y: 50,
    rotate: 0,
    scale: 1,
    opacity: 1,
    anim: null,
    shape: 'rect',
    width: 220,
    height: 140,
    fill: { kind: 'solid', color: '#5b8cff' },
    strokeWidth: 10,
    radius: 18,
    ...partial,
  }
}

export function makeImageLayer(partial?: Partial<ImageLayer>): ImageLayer {
  return {
    id: makeLayerId(),
    kind: 'image',
    name: 'Image',
    x: 50,
    y: 50,
    rotate: 0,
    scale: 1,
    opacity: 1,
    anim: null,
    src: '',
    width: 240,
    height: 240,
    radius: 0,
    fit: 'cover',
    ...partial,
  }
}

/** Clone + fill defaults so docs from older saves keep working. */
export function normalizeDesign(raw: any): DesignDoc {
  const base = makeDesign()
  const doc: DesignDoc = {
    ...base,
    ...raw,
    background: { ...base.background, ...(raw?.background ?? {}) },
    layers: [],
  }
  for (const l of raw?.layers ?? []) {
    const fresh =
      l.kind === 'text'
        ? makeTextLayer()
        : l.kind === 'image'
          ? makeImageLayer()
          : makeShapeLayer()
    doc.layers.push({ ...fresh, ...l, id: l.id ?? makeLayerId() } as DesignLayer)
  }
  doc.version = 1
  return doc
}

export function paintCss(p: Paint): string {
  return p.kind === 'solid'
    ? p.color
    : `linear-gradient(${p.angle}deg, ${p.from}, ${p.to})`
}

/** First color of a paint — used where gradients can't apply (borders, glows). */
export function paintAccent(p: Paint): string {
  return p.kind === 'solid' ? p.color : p.from
}

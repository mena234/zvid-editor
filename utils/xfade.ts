/**
 * Exact CSS/DOM realization of FFmpeg's vf_xfade.c transitions (n6.1.2 —
 * the FFmpeg the rendering package drives). Every formula below is a direct
 * port of the C source; `P` is FFmpeg's progress (1 → 0 across the
 * transition), `t = 1 - P` is the normalized "how far in" progress the
 * editor works with.
 *
 * xfade composites two streams: A (outgoing, `xf0`) and B (incoming,
 * `xf1`). The editor realizes one frame of that composite as a stack of
 * DOM layers, bottom → top:
 *
 *     [plate?]  [layer A]  [plateMid?]  [layer B]
 *
 * - scene / video↔video transitions ('transition' mode): both streams are
 *   real layers. For opaque full-canvas streams the returned styles are
 *   mathematically exact (`b` masked by its per-pixel coefficient over an
 *   unstyled `a` ≡ FFmpeg's mix on every plane).
 * - enter animations ('enter' mode): A is xfade's transparent canvas — only
 *   `b` (the item) + plates apply. FFmpeg runs this in straight (non
 *   premultiplied) alpha, so a plain fade lands at weight t² over the
 *   background (verified empirically); the flat-fade family compensates
 *   with brightness()+opacity, spatial ramps square the mask alpha.
 * - exit animations ('exit' mode): B is transparent — only `a` + plates.
 *
 * Ramped (smoothstep-boundary) effects are realized with multi-stop
 * gradient masks sampled from the exact profile — identical boundary
 * position/width/speed; the interpolation between samples is linear
 * instead of cubic, which is visually indistinguishable at 24+ samples.
 */

export type XfadeMode = 'transition' | 'enter' | 'exit'

export interface XfadeLayerCss {
  opacity?: number
  clipPath?: string
  transform?: string
  transformOrigin?: string
  filter?: string
  maskImage?: string
  /** set for raster masks that must stretch to the element */
  maskSize?: string
  visibility?: 'hidden'
}

export interface XfadePlateCss {
  color: string
  opacity: number
  maskImage?: string
  maskSize?: string
  clipPath?: string
}

export interface XfadeFrameCss {
  /** color plate under layer A (covers the xfade canvas) */
  plate?: XfadePlateCss
  a: XfadeLayerCss
  b: XfadeLayerCss
  /** layers move/scale — the canvas must clip them (overflow hidden) */
  clip?: boolean
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface XfadeOpts {
  mode: XfadeMode
  /** xfade canvas size: item box for enter/exit, full frame for transitions */
  canvasW: number
  canvasH: number
  /** element box of each layer within the canvas (defaults to full canvas) */
  rectA?: Rect
  rectB?: Rect
  /**
   * whether the animated content fills its box opaquely (video/image).
   * Enter/exit ramps add a darkening plate only for opaque content — for
   * text/SVG a plate would wrongly darken the backdrop around the glyphs.
   */
  contentOpaque?: boolean
  /**
   * on-screen device pixels per canvas px (stage zoom × devicePixelRatio).
   * SVG reference filters rasterize in DEVICE space: pixelize's sampling
   * dot must stay ≥ ~2 device px or Chromium snaps it to nothing and the
   * whole filtered layer vanishes at fractional zoom levels.
   */
  rasterScale?: number
}

/** display scale helper for callers (SSR-safe) */
export function deviceScale(cssScale = 1): number {
  return cssScale * (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1)
}

/* ------------------------------------------------------------------ */
/* math helpers (ports of vf_xfade.c statics)                          */
/* ------------------------------------------------------------------ */

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** vf_xfade.c smoothstep (edges may be reversed, as in the wind effects) */
export function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

/** vf_xfade.c frand — deterministic per-pixel noise */
export function frand(x: number, y: number) {
  const r = Math.sin(x * 12.9898 + y * 78.233) * 43758.545
  return r - Math.floor(r)
}

const fract = (v: number) => v - Math.floor(v)

const f2 = (v: number) => (Math.round(v * 100) / 100).toString()
const a3 = (v: number) => (Math.round(clamp01(v) * 1000) / 1000).toString()

const FULL: Rect = { x: 0, y: 0, w: 0, h: 0 }

/* ------------------------------------------------------------------ */
/* gradient-mask builders                                              */
/* ------------------------------------------------------------------ */

type AlphaAt = (canvasCoord: number) => number

/**
 * Sample an alpha profile along the x or y axis of the canvas into a
 * linear-gradient mask, positioned in the element's local px space.
 */
function axisMask(
  axis: 'x' | 'y',
  rect: Rect,
  alphaAt: AlphaAt,
  samples = 24
): string {
  const start = axis === 'x' ? rect.x : rect.y
  const extent = axis === 'x' ? rect.w : rect.h
  const stops: string[] = []
  for (let i = 0; i <= samples; i++) {
    const local = (i / samples) * extent
    stops.push(`rgba(0,0,0,${a3(alphaAt(start + local))}) ${f2(local)}px`)
  }
  return `linear-gradient(${axis === 'x' ? 90 : 180}deg, ${stops.join(', ')})`
}

/** radial mask centered on the canvas center, sampled over distance px */
function radialMask(
  rect: Rect,
  canvasW: number,
  canvasH: number,
  alphaAt: AlphaAt,
  samples = 24
): string {
  const cx = canvasW / 2 - rect.x
  const cy = canvasH / 2 - rect.y
  // farthest element corner from the center
  const rMax = Math.max(
    Math.hypot(cx, cy),
    Math.hypot(rect.w - cx, cy),
    Math.hypot(cx, rect.h - cy),
    Math.hypot(rect.w - cx, rect.h - cy)
  )
  const stops: string[] = []
  for (let i = 0; i <= samples; i++) {
    const r = (i / samples) * rMax
    stops.push(`rgba(0,0,0,${a3(alphaAt(r))}) ${f2(r)}px`)
  }
  return `radial-gradient(circle at ${f2(cx)}px ${f2(cy)}px, ${stops.join(', ')})`
}

/** conic mask around the canvas center; alphaAt takes the CSS conic angle in rad */
function conicMask(
  rect: Rect,
  canvasW: number,
  canvasH: number,
  alphaAt: AlphaAt,
  samples = 48
): string {
  const cx = canvasW / 2 - rect.x
  const cy = canvasH / 2 - rect.y
  const stops: string[] = []
  for (let i = 0; i <= samples; i++) {
    const phi = (i / samples) * 2 * Math.PI
    const deg = (phi * 180) / Math.PI
    stops.push(`rgba(0,0,0,${a3(alphaAt(phi))}) ${f2(deg)}deg`)
  }
  return `conic-gradient(from 0deg at ${f2(cx)}px ${f2(cy)}px, ${stops.join(', ')})`
}

/* ------------------------------------------------------------------ */
/* SVG data-URI masks (band/strip effects with 2D boundaries)          */
/* ------------------------------------------------------------------ */

const svgCache = new Map<string, string>()

function svgMask(key: string, build: () => string): string {
  let uri = svgCache.get(key)
  if (!uri) {
    uri = `url("data:image/svg+xml,${encodeURIComponent(build())}")`
    if (svgCache.size > 400) svgCache.clear()
    svgCache.set(key, uri)
  }
  return uri
}

/**
 * Inline SVG filter host. Chromium does not resolve CSS `filter: url(data:…)`
 * references, so animated filters (hblur, pixelize) are defined once in a
 * hidden in-document <svg><defs> and referenced by fragment id.
 */
const FILTER_HOST_ID = 'zvid-xfade-filter-defs'

function svgFilterRef(id: string, build: () => string): string | undefined {
  if (typeof document === 'undefined') return undefined
  let host = document.getElementById(FILTER_HOST_ID)
  if (!host) {
    host = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'svg'
    ) as unknown as HTMLElement
    host.setAttribute('id', FILTER_HOST_ID)
    host.setAttribute('width', '0')
    host.setAttribute('height', '0')
    host.setAttribute('aria-hidden', 'true')
    host.style.position = 'absolute'
    host.style.overflow = 'hidden'
    document.body.appendChild(host)
  }
  if (!document.getElementById(id)) {
    // never prune: defs are tiny and ids may be referenced by live styles
    host.insertAdjacentHTML('beforeend', build())
  }
  return `url(#${id})`
}

/**
 * Horizontal-strip SVG mask: one linear gradient per row band, sampled from
 * a 2D alpha field. Realizes non-separable ramps (diagonals) and per-row
 * randomized boundaries (wind) with smooth horizontal profiles.
 */
function stripedMaskSvg(
  rect: Rect,
  W: number,
  H: number,
  alphaAtUV: (u: number, v: number) => number,
  strips = 48,
  K = 20
): string {
  const sh = rect.h / strips
  let defs = ''
  let rects = ''
  for (let i = 0; i < strips; i++) {
    const v = (rect.y + (i + 0.5) * sh) / H
    const stops: string[] = []
    for (let k = 0; k <= K; k++) {
      const u = (rect.x + (k / K) * rect.w) / W
      stops.push(
        `<stop offset="${a3(k / K)}" stop-color="black" stop-opacity="${a3(
          alphaAtUV(u, v)
        )}"/>`
      )
    }
    defs += `<linearGradient id="g${i}" x1="0" y1="0" x2="1" y2="0">${stops.join('')}</linearGradient>`
    rects += `<rect x="0" y="${f2(i * sh)}" width="${f2(rect.w)}" height="${f2(
      sh + 0.5
    )}" fill="url(#g${i})"/>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${f2(rect.w)}" height="${f2(
    rect.h
  )}" viewBox="0 0 ${f2(rect.w)} ${f2(rect.h)}"><defs>${defs}</defs>${rects}</svg>`
}

/**
 * Rasterized 2D alpha-field mask (for non-separable ramps like the
 * diagonals): the exact field sampled to a small canvas, stretched over
 * the element with smooth upscaling.
 */
const canvasMaskCache = new Map<string, string>()

function canvasFieldMask(
  key: string,
  aspect: number,
  alphaAtUV: (u: number, v: number) => number
): string | undefined {
  if (typeof document === 'undefined') return undefined
  let uri = canvasMaskCache.get(key)
  if (!uri) {
    const mw = 240
    const mh = Math.min(400, Math.max(4, Math.round(mw / Math.max(0.1, aspect))))
    const cnv = document.createElement('canvas')
    cnv.width = mw
    cnv.height = mh
    const ctx = cnv.getContext('2d')
    if (!ctx) return undefined
    const img = ctx.createImageData(mw, mh)
    for (let y = 0; y < mh; y++) {
      const v = (y + 0.5) / mh
      for (let x = 0; x < mw; x++) {
        img.data[(y * mw + x) * 4 + 3] = Math.round(
          clamp01(alphaAtUV((x + 0.5) / mw, v)) * 255
        )
      }
    }
    ctx.putImageData(img, 0, 0)
    uri = `url("${cnv.toDataURL()}")`
    if (canvasMaskCache.size > 300) canvasMaskCache.clear()
    canvasMaskCache.set(key, uri)
  }
  return uri
}

/* dissolve noise masks: thresholded exact frand pattern, quantized levels */

const NOISE_W = 320
const NOISE_H = 180
const NOISE_LEVELS = 24
const noiseCache = new Map<number, string>()

function dissolveMask(threshold: number, invert: boolean): string | undefined {
  if (typeof document === 'undefined') return undefined
  const level = Math.round(clamp01(threshold) * NOISE_LEVELS)
  const key = invert ? -1 - level : level
  let uri = noiseCache.get(key)
  if (!uri) {
    const th = level / NOISE_LEVELS
    const cnv = document.createElement('canvas')
    cnv.width = NOISE_W
    cnv.height = NOISE_H
    const ctx = cnv.getContext('2d')
    if (!ctx) return undefined
    const img = ctx.createImageData(NOISE_W, NOISE_H)
    for (let y = 0; y < NOISE_H; y++) {
      for (let x = 0; x < NOISE_W; x++) {
        // B shown where frand*2 + P*2 - 1.5 < 0.5  ⇔  frand < t
        const on = frand(x, y) < th
        img.data[(y * NOISE_W + x) * 4 + 3] = on !== invert ? 255 : 0
      }
    }
    ctx.putImageData(img, 0, 0)
    uri = `url("${cnv.toDataURL()}")`
    noiseCache.set(key, uri)
  }
  return uri
}

/* ------------------------------------------------------------------ */
/* enter/exit straight-alpha helpers                                   */
/* ------------------------------------------------------------------ */

/**
 * FFmpeg mixes straight-alpha planes, so a stream shown at per-pixel
 * weight m over a transparent partner lands on screen at weight m²
 * (color and alpha both scale by m). Ramped masks square their alpha in
 * enter/exit modes; opaque content additionally gets a black plate
 * carrying the missing m·(1−m) darkening.
 */
function rampAlpha(m: number, single: boolean) {
  return single ? m * m : m
}
function rampPlateAlpha(m: number) {
  // solves: item(m²) over plate(p) over bg  ==  m²·b + (m−m²)·black + (1−m)·bg
  return m / (1 + m)
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

export function xfadeFrame(
  effect: string,
  tRaw: number,
  opts: XfadeOpts
): XfadeFrameCss {
  const t = clamp01(tRaw)
  const P = 1 - t
  const W = opts.canvasW
  const H = opts.canvasH
  const rectA = opts.rectA ?? { ...FULL, w: W, h: H }
  const rectB = opts.rectB ?? { ...FULL, w: W, h: H }
  const mode = opts.mode
  const single = mode !== 'transition'
  const opaque = opts.contentOpaque !== false

  const out: XfadeFrameCss = { a: {}, b: {} }

  /** apply a B-coefficient ramp mask (m = per-pixel weight of stream B). */
  const applyRamp = (
    makeMask: (rect: Rect, alphaAt: AlphaAt) => string,
    m: (coord: number) => number
  ) => {
    if (mode === 'exit') {
      // item is stream A → weight n = 1 − m
      out.a.maskImage = makeMask(rectA, (c) => rampAlpha(1 - m(c), true))
      if (opaque) {
        out.plate = {
          color: '#000',
          opacity: 1,
          maskImage: makeMask(rectA, (c) => rampPlateAlpha(1 - m(c))),
        }
      }
    } else {
      out.b.maskImage = makeMask(rectB, (c) => rampAlpha(m(c), single))
      if (single && opaque) {
        out.plate = {
          color: '#000',
          opacity: 1,
          maskImage: makeMask(rectB, (c) => rampPlateAlpha(m(c))),
        }
      }
    }
  }

  /** binary B-region as a clip-path (exact, no alpha subtleties).
   *  Enter/exit run against xfade's "transparent" color canvas, which the
   *  render pipeline flattens to opaque BLACK — so for opaque content the
   *  complement region gets a black plate (verified against real renders:
   *  an exiting wipe leaves a black box, not the backdrop). */
  const applyClip = (clipFor: (rect: Rect, invert: boolean) => string) => {
    if (mode === 'exit') {
      out.a.clipPath = clipFor(rectA, true)
      if (opaque) out.plate = { color: '#000', opacity: 1, clipPath: clipFor(rectA, false) }
    } else {
      out.b.clipPath = clipFor(rectB, false)
      if (single && opaque) {
        out.plate = { color: '#000', opacity: 1, clipPath: clipFor(rectB, true) }
      }
    }
  }

  /**
   * flat fade family: on-screen weights are uniform. For enter/exit the
   * exact composite is item at opacity βi with brightness f (+ optional
   * plate), derived from the straight-alpha coefficients:
   *   Cb = item color coeff, Cplate = plate color coeff, Cbg = 1 − alpha.
   */
  const applyFlat = (
    Cb: number,
    Cbg: number,
    plateColor?: string,
    Cplate = 0
  ) => {
    if (mode === 'transition') {
      // plate (opacity 1) under a(αa) under b(αb): exact for opaque streams
      const ab = Cb
      const aa = ab >= 1 ? 0 : clamp01((1 - Cbg - Cplate - Cb) / (1 - ab))
      out.b.opacity = clamp01(ab)
      if (plateColor) {
        out.a.opacity = aa
        out.plate = { color: plateColor, opacity: 1 }
      } else {
        // no plate: plain crossfade — b over full a
      }
      return
    }
    const layer = mode === 'enter' ? out.b : out.a
    const Cblack = Math.max(0, 1 - Cb - Cbg - Cplate)
    const bi = clamp01(Cb + Cblack)
    layer.opacity = bi
    const f = bi > 0 ? clamp01(Cb / bi) : 1
    if (f < 0.999) layer.filter = `brightness(${a3(f)})`
    if (plateColor && Cplate > 0.001) {
      out.plate = {
        color: plateColor,
        opacity: clamp01(Cplate / Math.max(0.0001, Cplate + Cbg)),
      }
    }
  }

  /** applyFlat, but compose its brightness() with an already-set filter */
  const applyFlatKeepFilter = (Cb: number, Cbg: number) => {
    const layer = mode === 'enter' ? out.b : out.a
    const prev = layer.filter
    layer.filter = undefined
    applyFlat(Cb, Cbg)
    if (prev) layer.filter = layer.filter ? `${prev} ${layer.filter}` : prev
  }

  const hideInactive = () => {
    if (mode === 'enter') out.a.visibility = 'hidden'
    if (mode === 'exit') out.b.visibility = 'hidden'
  }

  switch (effect) {
    /* ------------------------------ fades ------------------------------ */
    case 'fade': {
      // dst = mix(a, b, P) = a·P + b·(1−P); straight alpha ⇒ the shown
      // item weight is t² (enter) / P² (exit) with the rest going to black
      if (mode === 'transition') applyFlat(t, 0)
      else if (mode === 'enter') applyFlat(t * t, P)
      else applyFlat(P * P, t)
      break
    }
    case 'fadeblack':
    case 'fadewhite': {
      // dst = mix(mix(a,BG,ss(.8,1,P)), mix(BG,b,ss(.2,1,P)), P)
      const s1 = smoothstep(0.8, 1, P)
      const s2 = smoothstep(0.2, 1, P)
      const color = effect === 'fadeblack' ? '#000' : '#fff'
      if (mode === 'transition') {
        const Cb = t * (1 - s2)
        const Ca = P * s1
        const Cplate = 1 - Cb - Ca
        out.b.opacity = clamp01(Cb)
        out.a.opacity = Cb >= 1 ? 0 : clamp01(Ca / (1 - Cb))
        out.plate = { color, opacity: 1 }
      } else if (mode === 'enter') {
        // alpha planes: item pixels α1 = 1−P·s1, plate-only α0 = P(1−s1)+t·s2
        const a1 = 1 - P * s1
        const Cb = t * (1 - s2) * a1
        const Cbg = 1 - a1
        const Cplate = effect === 'fadewhite' ? a1 * (P * (1 - s1) + t * s2) : 0
        applyFlat(Cb, Cbg, effect === 'fadewhite' ? color : undefined, Cplate)
        if (!opaque && effect === 'fadeblack') {
          // black box over the item bounds (canvas alpha is opaque there)
          out.plate = { color, opacity: clamp01(P * (1 - s1) + t * s2) }
        }
      } else {
        // exit: item is A. dst = mix(mix(a,BG,s1), mix(BG,b→0,s2), P):
        // item coeff P·s1, plate coeff P(1−s1)+t·s2 (BG canvas is opaque),
        // bg shows at t(1−s2)
        const Ca = P * s1 * (1 - t * (1 - s2))
        const Cbg = t * (1 - s2)
        const Cplate =
          effect === 'fadewhite' ? (1 - Cbg) * (P * (1 - s1) + t * s2) : 0
        applyFlat(Ca, Cbg, effect === 'fadewhite' ? color : undefined, Cplate)
        if (!opaque && effect === 'fadeblack') {
          out.plate = { color, opacity: clamp01(P * (1 - s1) + t * s2) }
        }
      }
      hideInactive()
      break
    }
    case 'fadegrays': {
      // like fadeblack but through each stream's own grayscale
      const s1 = smoothstep(0.8, 1, P)
      const s2 = smoothstep(0.2, 1, P)
      if (mode === 'transition') {
        out.a.filter = `grayscale(${a3(1 - s1)})`
        out.b.filter = `grayscale(${a3(s2)})`
        out.b.opacity = t
      } else if (mode === 'enter') {
        const bi = t // alpha = t (gray canvas keeps the item's own alpha)
        out.b.opacity = bi
        out.b.filter = `grayscale(${a3(s2)}) brightness(${a3(t)})`
      } else {
        out.a.opacity = P
        out.a.filter = `grayscale(${a3(1 - s1)}) brightness(${a3(P)})`
      }
      hideInactive()
      break
    }
    case 'dissolve': {
      // B where frand(x,y) < t (hard per-pixel threshold); A is the complement
      const mask = dissolveMask(t, mode === 'exit')
      if (mask) {
        if (mode === 'exit') out.a.maskImage = mask
        else out.b.maskImage = mask
      } else {
        // SSR — no canvas available
        if (mode === 'exit') out.a.opacity = P
        else out.b.opacity = t
      }
      break
    }
    case 'distance': {
      // per-pixel color-distance gate — not realizable in DOM; the global
      // envelope mix(mix(a,b,dist), b, P) trends from a to b like a fade
      if (mode === 'transition') applyFlat(t, 0)
      else if (mode === 'enter') applyFlat(t * t, P)
      else applyFlat(P * P, t)
      break
    }

    /* ------------------------------ wipes ------------------------------ */
    case 'wipeleft': // B where x > W·P
      applyClip((r, inv) =>
        inv
          ? `inset(0 ${f2(r.w - (W * P - r.x))}px 0 0)`
          : `inset(0 0 0 ${f2(W * P - r.x)}px)`
      )
      break
    case 'wiperight': // B where x < W·t
      applyClip((r, inv) =>
        inv
          ? `inset(0 0 0 ${f2(W * t - r.x)}px)`
          : `inset(0 ${f2(r.w - (W * t - r.x))}px 0 0)`
      )
      break
    case 'wipeup': // B where y > H·P
      applyClip((r, inv) =>
        inv
          ? `inset(0 0 ${f2(r.h - (H * P - r.y))}px 0)`
          : `inset(${f2(H * P - r.y)}px 0 0 0)`
      )
      break
    case 'wipedown': // B where y < H·t
      applyClip((r, inv) =>
        inv
          ? `inset(${f2(H * t - r.y)}px 0 0 0)`
          : `inset(0 0 ${f2(r.h - (H * t - r.y))}px 0)`
      )
      break

    case 'wipetl':
    case 'wipetr':
    case 'wipebl':
    case 'wipebr': {
      // A occupies a corner rectangle; B is the complementary L-shape
      const left = effect === 'wipetl' || effect === 'wipebl'
      const top = effect === 'wipetl' || effect === 'wipetr'
      const zw = left ? W * P : W * (1 - P) // A-rect vertical edge
      const zh = top ? H * P : H * (1 - P) // A-rect horizontal edge
      if (mode === 'exit') {
        const r = rectA
        const x0 = (left ? 0 : zw) - r.x
        const x1 = (left ? zw : W) - r.x
        const y0 = (top ? 0 : zh) - r.y
        const y1 = (top ? zh : H) - r.y
        out.a.clipPath = `polygon(${f2(x0)}px ${f2(y0)}px, ${f2(x1)}px ${f2(
          y0
        )}px, ${f2(x1)}px ${f2(y1)}px, ${f2(x0)}px ${f2(y1)}px)`
      } else {
        const r = rectB
        const X = (v: number) => `${f2(v - r.x)}px`
        const Y = (v: number) => `${f2(v - r.y)}px`
        // 6-point L-shape = canvas minus the A corner rectangle
        let pts: string
        if (effect === 'wipetl')
          pts = `${X(zw)} ${Y(0)}, ${X(W)} ${Y(0)}, ${X(W)} ${Y(H)}, ${X(0)} ${Y(H)}, ${X(0)} ${Y(zh)}, ${X(zw)} ${Y(zh)}`
        else if (effect === 'wipetr')
          pts = `${X(0)} ${Y(0)}, ${X(zw)} ${Y(0)}, ${X(zw)} ${Y(zh)}, ${X(W)} ${Y(zh)}, ${X(W)} ${Y(H)}, ${X(0)} ${Y(H)}`
        else if (effect === 'wipebl')
          pts = `${X(0)} ${Y(0)}, ${X(W)} ${Y(0)}, ${X(W)} ${Y(H)}, ${X(zw)} ${Y(H)}, ${X(zw)} ${Y(zh)}, ${X(0)} ${Y(zh)}`
        else
          pts = `${X(0)} ${Y(0)}, ${X(W)} ${Y(0)}, ${X(W)} ${Y(zh)}, ${X(zw)} ${Y(zh)}, ${X(zw)} ${Y(H)}, ${X(0)} ${Y(H)}`
        out.b.clipPath = `polygon(${pts})`
      }
      break
    }

    /* ------------------------------ slides ----------------------------- */
    case 'slideleft':
      out.a.transform = `translateX(${f2(-t * W)}px)`
      out.b.transform = `translateX(${f2(P * W)}px)`
      out.clip = true
      break
    case 'slideright':
      out.a.transform = `translateX(${f2(t * W)}px)`
      out.b.transform = `translateX(${f2(-P * W)}px)`
      out.clip = true
      break
    case 'slideup':
      out.a.transform = `translateY(${f2(-t * H)}px)`
      out.b.transform = `translateY(${f2(P * H)}px)`
      out.clip = true
      break
    case 'slidedown':
      out.a.transform = `translateY(${f2(t * H)}px)`
      out.b.transform = `translateY(${f2(-P * H)}px)`
      out.clip = true
      break

    /* --------------------------- smooth wipes -------------------------- */
    case 'smoothleft': // m = ss(0,1, 1 + x/W − 2P)
      applyRamp(
        (r, al) => axisMask('x', r, al),
        (x) => smoothstep(0, 1, 1 + x / W - 2 * P)
      )
      break
    case 'smoothright':
      applyRamp(
        (r, al) => axisMask('x', r, al),
        (x) => smoothstep(0, 1, 1 + (W - 1 - x) / W - 2 * P)
      )
      break
    case 'smoothup':
      applyRamp(
        (r, al) => axisMask('y', r, al),
        (y) => smoothstep(0, 1, 1 + y / H - 2 * P)
      )
      break
    case 'smoothdown':
      applyRamp(
        (r, al) => axisMask('y', r, al),
        (y) => smoothstep(0, 1, 1 + (H - 1 - y) / H - 2 * P)
      )
      break

    /* ------------------------- circles / doors ------------------------- */
    case 'circleopen': {
      // m = 1 − ss(0,1, dist/z + (P−0.5)·3), z = hypot(W/2, H/2)
      const z = Math.hypot(W / 2, H / 2)
      applyRamp(
        (r, al) => radialMask(r, W, H, al),
        (dist) => 1 - smoothstep(0, 1, dist / z + (P - 0.5) * 3)
      )
      break
    }
    case 'circleclose': {
      const z = Math.hypot(W / 2, H / 2)
      applyRamp(
        (r, al) => radialMask(r, W, H, al),
        (dist) => smoothstep(0, 1, dist / z + (0.5 - P) * 3)
      )
      break
    }
    case 'horzopen': // m = ss(0,1, 2 − |y−h2|/h2 − 2P)
      applyRamp(
        (r, al) => axisMask('y', r, al, 32),
        (y) => smoothstep(0, 1, 2 - Math.abs((y - H / 2) / (H / 2)) - 2 * P)
      )
      break
    case 'horzclose':
      applyRamp(
        (r, al) => axisMask('y', r, al, 32),
        (y) => smoothstep(0, 1, 1 + Math.abs((y - H / 2) / (H / 2)) - 2 * P)
      )
      break
    case 'vertopen':
      applyRamp(
        (r, al) => axisMask('x', r, al, 32),
        (x) => smoothstep(0, 1, 2 - Math.abs((x - W / 2) / (W / 2)) - 2 * P)
      )
      break
    case 'vertclose':
      applyRamp(
        (r, al) => axisMask('x', r, al, 32),
        (x) => smoothstep(0, 1, 1 + Math.abs((x - W / 2) / (W / 2)) - 2 * P)
      )
      break

    case 'circlecrop': {
      // z = (2|P−0.5|)³·hypot(W/2,H/2); black outside; A first half, B second
      const z = Math.pow(2 * Math.abs(P - 0.5), 3) * Math.hypot(W / 2, H / 2)
      const active = P < 0.5 ? 'b' : 'a'
      const r = active === 'a' ? rectA : rectB
      const circle = `circle(${f2(z)}px at ${f2(W / 2 - r.x)}px ${f2(
        H / 2 - r.y
      )}px)`
      if (active === 'a') {
        out.a.clipPath = circle
        out.b.visibility = 'hidden'
      } else {
        out.b.clipPath = circle
        out.a.visibility = 'hidden'
      }
      // opaque black plate with a circular hole where the active stream shows
      out.plate = {
        color: '#000',
        opacity: 1,
        maskImage: `radial-gradient(circle at ${f2(W / 2)}px ${f2(
          H / 2
        )}px, transparent ${f2(z)}px, #000 ${f2(z)}px)`,
      }
      break
    }
    case 'rectcrop': {
      // half-extents zw=|P−0.5|·W, zh=|P−0.5|·H around center; black outside
      const zw = Math.abs(P - 0.5) * W
      const zh = Math.abs(P - 0.5) * H
      const active = P < 0.5 ? 'b' : 'a'
      const r = active === 'a' ? rectA : rectB
      const ins = (v: number) => f2(Math.max(0, v))
      const clip = `inset(${ins(H / 2 - zh - r.y)}px ${ins(
        r.w - (W / 2 + zw - r.x)
      )}px ${ins(r.h - (H / 2 + zh - r.y))}px ${ins(W / 2 - zw - r.x)}px)`
      if (active === 'a') {
        out.a.clipPath = clip
        out.b.visibility = 'hidden'
      } else {
        out.b.clipPath = clip
        out.a.visibility = 'hidden'
      }
      // opaque black plate with a rectangular hole (keyhole polygon)
      const hx0 = f2(W / 2 - zw)
      const hx1 = f2(W / 2 + zw)
      const hy0 = f2(H / 2 - zh)
      const hy1 = f2(H / 2 + zh)
      out.plate = {
        color: '#000',
        opacity: 1,
        clipPath: `polygon(0px 0px, ${f2(W)}px 0px, ${f2(W)}px ${f2(H)}px, 0px ${f2(
          H
        )}px, 0px ${hy0}px, ${hx0}px ${hy0}px, ${hx0}px ${hy1}px, ${hx1}px ${hy1}px, ${hx1}px ${hy0}px, 0px ${hy0}px)`,
      }
      break
    }

    /* ----------------------------- diagonals --------------------------- */
    case 'diagtl':
    case 'diagtr':
    case 'diagbl':
    case 'diagbr': {
      // m = ss(0,1, 1 + e − 2P) with e the corner product (hyperbolic bands)
      const eAt = (u: number, v: number) => {
        const uu = effect === 'diagtr' || effect === 'diagbr' ? 1 - u : u
        const vv = effect === 'diagbl' || effect === 'diagbr' ? 1 - v : v
        return uu * vv
      }
      const mAt = (u: number, v: number) =>
        smoothstep(0, 1, 1 + eAt(u, v) - 2 * P)
      const rect = mode === 'exit' ? rectA : rectB
      const tq = Math.round(t * 200)
      const key = `diag:${effect}:${tq}:${W}x${H}:${rect.x},${rect.y},${rect.w},${rect.h}:${mode}:${opaque ? 1 : 0}`
      const aspect = rect.w / Math.max(1, rect.h)
      // element-local uv → canvas uv, exact 2D field rasterized to a mask
      const build = (alphaOf: (m: number) => number) =>
        canvasFieldMask(key + ':' + (mode === 'exit' ? 'a' : 'b'), aspect, (u, v) =>
          alphaOf(mAt((rect.x + u * rect.w) / W, (rect.y + v * rect.h) / H))
        )
      const buildPlate = () =>
        canvasFieldMask(key + ':p', aspect, (u, v) =>
          rampPlateAlpha(
            mode === 'exit'
              ? 1 - mAt((rect.x + u * rect.w) / W, (rect.y + v * rect.h) / H)
              : mAt((rect.x + u * rect.w) / W, (rect.y + v * rect.h) / H)
          )
        )
      const layer = mode === 'exit' ? out.a : out.b
      const mask = build(
        mode === 'exit'
          ? (m) => rampAlpha(1 - m, true)
          : (m) => rampAlpha(m, single)
      )
      if (mask) {
        layer.maskImage = mask
        layer.maskSize = '100% 100%'
        const needsPlate =
          mode === 'exit' ? opaque : single && opaque
        if (needsPlate) {
          const pm = buildPlate()
          if (pm)
            out.plate = {
              color: '#000',
              opacity: 1,
              maskImage: pm,
              maskSize: '100% 100%',
            }
        }
      } else {
        // SSR fallback: flat crossfade envelope
        if (mode === 'exit') out.a.opacity = P
        else out.b.opacity = t
      }
      break
    }

    /* ------------------------------ slices ----------------------------- */
    case 'hlslice':
    case 'hrslice':
    case 'vuslice':
    case 'vdslice': {
      // per 1/10 slice: B fills where fract(10q) < ss(−0.5, 0, q − 1.5P)
      const horiz = effect === 'hlslice' || effect === 'hrslice'
      const rev = effect === 'hrslice' || effect === 'vdslice'
      const rect = mode === 'exit' ? rectA : rectB
      const canvasExtent = horiz ? W : H
      const stops: string[] = []
      const shownAt = (coord: number) => {
        const q = rev
          ? (canvasExtent - 1 - coord) / canvasExtent
          : coord / canvasExtent
        const smooth = smoothstep(-0.5, 0, q - P * 1.5)
        const b = smooth > fract(10 * q) ? 1 : 0
        return mode === 'exit' ? 1 - b : b
      }
      // hard stops at every on/off crossing along the element
      const start = horiz ? rect.x : rect.y
      const extent = horiz ? rect.w : rect.h
      const steps = 400
      let prev = shownAt(start)
      stops.push(`rgba(0,0,0,${prev}) 0px`)
      for (let i = 1; i <= steps; i++) {
        const local = (i / steps) * extent
        const cur = shownAt(start + local)
        if (cur !== prev) {
          stops.push(`rgba(0,0,0,${prev}) ${f2(local)}px`)
          stops.push(`rgba(0,0,0,${cur}) ${f2(local)}px`)
          prev = cur
        }
      }
      stops.push(`rgba(0,0,0,${prev}) ${f2(extent)}px`)
      const grad = `linear-gradient(${horiz ? 90 : 180}deg, ${stops.join(', ')})`
      if (mode === 'exit') out.a.maskImage = grad
      else out.b.maskImage = grad
      break
    }

    /* ------------------------------- misc ------------------------------ */
    case 'radial': {
      // m = ss(0,1, atan2(dx,dy) − (P−0.5)·2.5π); atan2 angle θ = π − φ_css
      const off = (P - 0.5) * Math.PI * 2.5
      applyRamp(
        (r, al) => conicMask(r, W, H, al),
        (phi) => smoothstep(0, 1, Math.PI - phi - off)
      )
      break
    }
    case 'pixelize': {
      // mosaic with the exact block-size curve: d = min(t,1−t) quantized to
      // 1/50 steps, cell = 2·d·min(W,H)/20. Realized as the classic SVG
      // point-sample + tile + dilate pixelation filter (nearest-sample
      // mosaic instead of FFmpeg's cell-averaged mosaic).
      const d = Math.min(t, 1 - t)
      const dist = Math.ceil(d * 50) / 50
      // exact float cell size — FFmpeg's grid uses the float sqx/sqy, and
      // dist is already quantized to 1/50 so the id count stays bounded
      const sq = (2 * dist * Math.min(W, H)) / 20
      const rs = Math.max(0.05, opts.rasterScale ?? 1)
      // only pixelate when a cell is ≥ ~2.5 device px — below that the
      // sampling dot cannot survive rasterization (Chromium would drop the
      // whole layer) and the mosaic is invisible anyway
      if (sq > 1.01 && sq * rs >= 2.5) {
        /**
         * Raster-safety: SVG reference filters rasterize with the
         * accumulated CTM. A 1px sampling dot pixel-snaps to NOTHING at
         * fractional zoom (the filtered layer turns fully transparent), so
         * size the dot ≥ ~2 device px and overlap blocks by ~0.5 device px
         * to close raster-snap seams. The grid is anchored to the CANVAS
         * origin (FFmpeg re-bases streams to the full frame).
         */
        const makeRef = (rect: Rect) => {
          const gx = -(((rect.x % sq) + sq) % sq)
          const gy = -(((rect.y % sq) + sq) % sq)
          const dot = Math.min(Math.max(1.5, 2 / rs), sq / 2)
          const eps = Math.min(0.5 / rs, sq / 6)
          const radius = (sq - dot) / 2 + eps
          const id = `zvxf-pix-${Math.round(sq * 100)}-${Math.round(rs * 8)}-${Math.round(-gx)}x${Math.round(-gy)}`
          // color-interpolation-filters=sRGB: SVG filters default to
          // linearRGB, but FFmpeg mixes gamma-encoded values — and a chained
          // brightness() inherits the url() segment's space (probed: 157 vs
          // the correct 127)
          return svgFilterRef(
            id,
            () =>
              `<filter id="${id}" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">` +
              `<feFlood x="${f2(gx + sq / 2 - dot / 2)}" y="${f2(gy + sq / 2 - dot / 2)}" width="${f2(dot)}" height="${f2(dot)}" result="dot"/>` +
              `<feComposite in="dot" in2="dot" operator="over" x="${f2(gx)}" y="${f2(gy)}" width="${f2(sq)}" height="${f2(sq)}" result="cell"/>` +
              `<feTile in="cell" result="grid"/>` +
              `<feComposite in="SourceGraphic" in2="grid" operator="in" result="pts"/>` +
              `<feMorphology in="pts" operator="dilate" radius="${f2(radius)}"/></filter>`
          )
        }
        if (mode === 'transition') {
          const ra = makeRef(rectA)
          const rb = makeRef(rectB)
          if (ra) out.a.filter = ra
          if (rb) out.b.filter = rb
        } else {
          // enter/exit canvas IS the item box → rect offsets are 0
          const ref = makeRef(mode === 'exit' ? rectA : rectB)
          if (ref) {
            out.a.filter = ref
            out.b.filter = ref
          }
        }
      }
      // probed enter render follows the flat t² envelope (t=0.5 → 0x80)
      if (mode === 'transition') out.b.opacity = t
      else if (mode === 'enter') applyFlatKeepFilter(t * t, P)
      else applyFlatKeepFilter(P * P, t)
      break
    }
    case 'hblur': {
      // horizontal box blur peaking at P=0.5 (size up to W/2), linear fade.
      // Realized as a horizontal-only in-document SVG gaussian (Chromium
      // cannot reference data-URI filters from CSS `filter`).
      const prog = P <= 0.5 ? P * 2 : (1 - P) * 2
      const size = 1 + (W / 2) * prog
      const sigma = Math.min(80, size / Math.sqrt(12))
      if (sigma > 0.3) {
        // integer sigma keeps the def count bounded (defs are never pruned)
        const q = Math.max(1, Math.round(sigma))
        const id = `zvxf-hblur-${q}`
        const ref = svgFilterRef(
          id,
          () =>
            `<filter id="${id}" x="-30%" y="-30%" width="160%" height="160%" color-interpolation-filters="sRGB">` +
            `<feGaussianBlur stdDeviation="${q} 0"/></filter>`
        )
        if (ref) {
          out.a.filter = ref
          out.b.filter = ref
        }
      }
      if (mode === 'transition') out.b.opacity = t
      else if (mode === 'enter') applyFlatKeepFilter(t * t, P)
      else applyFlatKeepFilter(P * P, t)
      break
    }
    case 'zoomin': {
      // A magnified by 1/ss(0.5,1,P) (center), B fades in over P∈[0.5,0].
      // Probed enter render: on-screen weight follows the flat (1−m)² law
      // (t=0.6 → 0x75, t=0.9 → 0xd9 over gray).
      const zf = smoothstep(0.5, 1, P)
      const scale = 1 / Math.max(zf, 1 / 48)
      out.a.transform = `scale(${f2(Math.min(48, scale))})`
      out.a.transformOrigin = `${f2(W / 2 - rectA.x)}px ${f2(H / 2 - rectA.y)}px`
      const m = smoothstep(0, 0.5, P) // weight of zoomed A
      if (mode === 'transition') out.b.opacity = 1 - m
      else if (mode === 'enter') applyFlat((1 - m) * (1 - m), m)
      else applyFlat(m * m, 1 - m) // exit: the item is the zooming A stream
      out.clip = true
      break
    }
    case 'hlwind':
    case 'hrwind': {
      // per-row random offset streaks; m = ss(0,−0.2, fx·0.8 + 0.2r − 1.2t)
      const rect = mode === 'exit' ? rectA : rectB
      const tq = Math.round(t * 200)
      const key = `wind:${effect}:${tq}:${W}x${H}:${rect.x},${rect.y},${rect.w},${rect.h}:${mode}`
      const uri = svgMask(key, () =>
        stripedMaskSvg(rect, W, H, (u, v) => {
          // exact frand of the strip's center row (canvas px)
          const r = frand(0, Math.round(v * H))
          const fx = effect === 'hlwind' ? 1 - u : u
          const m = smoothstep(0, -0.2, fx * (1 - 0.2) + 0.2 * r - t * (1 + 0.2))
          return mode === 'exit' ? rampAlpha(1 - m, true) : rampAlpha(m, single)
        })
      )
      if (mode === 'exit') out.a.maskImage = uri
      else out.b.maskImage = uri
      break
    }

    default:
      // unknown effect → plain crossfade
      if (mode === 'transition') applyFlat(t, 0)
      else if (mode === 'enter') applyFlat(t * t, P)
      else applyFlat(P * P, t)
      break
  }

  // slides run against the flattened-black canvas too: for enter/exit the
  // vacated region shows BLACK in the render (same alpha flattening as the
  // clip family), not the backdrop — plate the whole item canvas under the
  // translated layer for opaque content
  if (
    single &&
    opaque &&
    !out.plate &&
    /^slide(left|right|up|down)$/.test(effect)
  ) {
    out.plate = { color: '#000', opacity: 1 }
  }

  return out
}

/** XfadeLayerCss → Vue style object (with -webkit mask fallback) */
export function layerStyle(
  l?: XfadeLayerCss | null
): Record<string, string | number | undefined> {
  if (!l) return {}
  return {
    opacity: l.opacity,
    clipPath: l.clipPath,
    transform: l.transform,
    transformOrigin: l.transformOrigin,
    filter: l.filter,
    visibility: l.visibility,
    maskImage: l.maskImage,
    '-webkit-mask-image': l.maskImage,
    maskSize: l.maskSize,
    '-webkit-mask-size': l.maskSize,
  }
}

/** XfadePlateCss → Vue style object for an absolutely-positioned plate div */
export function plateStyle(
  p?: XfadePlateCss | null
): Record<string, string | number | undefined> {
  if (!p) return {}
  return {
    background: p.color,
    opacity: p.opacity,
    clipPath: p.clipPath,
    maskImage: p.maskImage,
    '-webkit-mask-image': p.maskImage,
    maskSize: p.maskSize,
    '-webkit-mask-size': p.maskSize,
  }
}

/**
 * Effects whose DOM realization is approximate (different rendering
 * primitive, quantized pattern, or per-pixel math CSS cannot express).
 * Everything else matches FFmpeg's geometry and curves exactly.
 */
export function isApproximateEffect(effect: string): boolean {
  return [
    'distance', // per-pixel color-distance gate
    'pixelize', // point-sample mosaic vs FFmpeg's cell-average mosaic
    'hblur', // box blur → gaussian, capped radius
    'dissolve', // exact frand pattern but quantized levels / scaled grid
    'hlwind', // strip-quantized rows
    'hrwind',
  ].includes(effect)
}

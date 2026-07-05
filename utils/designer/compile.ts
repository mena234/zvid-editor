import type { DesignDoc, DesignLayer, TextLayer, ShapeLayer, ImageLayer } from './types'
import { paintAccent, paintCss } from './types'
import { animPreset, easingValue, type AnimCtx } from './animations'
import { shapeDef, shapeSvgMarkup, shapeCssDecls } from './shapes'

/**
 * Compiles a DesignDoc into the exact payload a TEXT element needs:
 * `html` markup + `customCode.css` (keyframes included) + a loop duration.
 *
 * Everything is namespaced under `.dz-*` classes so it can't collide with
 * the capture page's own `.container` styles, and the output is CSS-only —
 * safe against the package's customCode sanitizer (no @import, no external
 * url(), no JS).
 */

export interface CompiledDesign {
  html: string
  css: string
  /** resolved loop duration (s) — auto-derived unless the doc pins one */
  duration: number
  width: number
  height: number
  fontFamily: string
  /** false when no layer animates (still uses customCode for layout css) */
  animated: boolean
  warnings: string[]
}

const MAX_LOOP = 15

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;')
}

/** Strip characters that could break out of a CSS declaration value. */
function cssSafe(s: string): string {
  return String(s).replace(/[{}<>;]/g, '')
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

/* ------------------------------------------------------------------ */
/* text splitting                                                      */
/* ------------------------------------------------------------------ */

interface SplitResult {
  html: string
  count: number
}

/** {{placeholder}} runs — must survive splitting intact so the render can
 *  still find and resolve them in the compiled html string. */
const VAR_TOKEN_RE = /\{\{[^{}]*\}\}/g

/** Trim inside {{ }} so a placeholder never contains spaces (word splitting
 *  would otherwise cut it apart and break render-time resolution). */
function normalizeVars(text: string): string {
  return text.replace(VAR_TOKEN_RE, (m) => `{{${m.slice(2, -2).trim()}}}`)
}

/** Split a word into stagger units: plain characters, with each whole
 *  {{placeholder}} kept as a single atomic unit. */
function charUnits(word: string): string[] {
  const units: string[] = []
  let last = 0
  VAR_TOKEN_RE.lastIndex = 0
  for (const m of word.matchAll(VAR_TOKEN_RE)) {
    units.push(...word.slice(last, m.index))
    units.push(m[0])
    last = m.index! + m[0].length
  }
  units.push(...word.slice(last))
  return units
}

/**
 * Wraps letters/words in indexed spans (`--i`) for staggered animation.
 * Letters stay grouped inside word spans so lines still wrap at spaces.
 * {{placeholders}} count as one unit and stay contiguous in the output —
 * the render resolves them inside their span at capture time.
 */
export function splitTextHtml(text: string, mode: 'letter' | 'word' | 'none'): SplitResult {
  if (mode === 'none') {
    return { html: escapeHtml(text).replace(/\n/g, '<br>'), count: 1 }
  }
  let i = 0
  const lines = normalizeVars(text).split('\n').map((line) => {
    const words = line.split(' ').filter((w) => w.length > 0)
    const parts = words.map((word) => {
      if (mode === 'word') {
        return `<span class="dz-c" style="--i:${i++}">${escapeHtml(word)}</span>`
      }
      const chars = charUnits(word)
        .map((ch) => `<span class="dz-c" style="--i:${i++}">${escapeHtml(ch)}</span>`)
        .join('')
      return `<span class="dz-w">${chars}</span>`
    })
    return parts.join(' ')
  })
  return { html: lines.join('<br>'), count: Math.max(1, i) }
}

/* ------------------------------------------------------------------ */
/* per-layer compilation                                               */
/* ------------------------------------------------------------------ */

interface LayerOut {
  html: string
  css: string
  animCss: string
  entranceEnd: number
  loopPeriod: number
}

function layerPlacementCss(sel: string, l: DesignLayer): string {
  const transforms = [`translate(-50%, -50%)`]
  if (l.rotate) transforms.push(`rotate(${round2(l.rotate)}deg)`)
  if (l.scale !== 1) transforms.push(`scale(${round2(l.scale)})`)
  const decls = [
    `position: absolute`,
    `left: ${round2(l.x)}%`,
    `top: ${round2(l.y)}%`,
    `transform: ${transforms.join(' ')}`,
  ]
  if (l.opacity !== 1) decls.push(`opacity: ${round2(l.opacity)}`)
  return `${sel} { ${decls.join('; ')}; }`
}

function textContentCss(sel: string, l: TextLayer, split: boolean): string {
  const rules: string[] = []
  const decls: string[] = [
    `font-size: ${l.fontSize}px`,
    `font-weight: ${cssSafe(l.fontWeight)}`,
    `line-height: ${l.lineHeight}`,
    `text-align: ${l.align}`,
  ]
  if (l.letterSpacing) decls.push(`letter-spacing: ${l.letterSpacing}em`)
  if (l.textTransform) decls.push(`text-transform: ${l.textTransform}`)
  if (l.width) decls.push(`width: ${l.width}px`)
  else decls.push(`width: max-content`, `max-width: none`)
  if (l.fill.kind === 'solid') decls.push(`color: ${cssSafe(l.fill.color)}`)
  if (l.stroke && l.stroke.width > 0)
    decls.push(`-webkit-text-stroke: ${l.stroke.width}px ${cssSafe(l.stroke.color)}`)
  if (l.shadow)
    decls.push(
      `text-shadow: ${l.shadow.x}px ${l.shadow.y}px ${l.shadow.blur}px ${cssSafe(l.shadow.color)}`
    )
  rules.push(`${sel} { ${decls.join('; ')}; }`)

  const aDecls: string[] = [`display: inline-block`]
  if (l.pill) {
    aDecls.push(
      `background: ${cssSafe(l.pill.color)}`,
      `padding: ${l.pill.padY}px ${l.pill.padX}px`,
      `border-radius: ${l.pill.radius}px`
    )
  }
  rules.push(`${sel} .dz-a { ${aDecls.join('; ')}; }`)

  if (l.fill.kind === 'gradient') {
    // split text gets the gradient per glyph span (its own paint box) so
    // opacity/transform char animations still composite correctly
    const target = split ? `${sel} .dz-c` : `${sel} .dz-a`
    rules.push(
      `${target} { background-image: linear-gradient(${l.fill.angle}deg, ${cssSafe(l.fill.from)}, ${cssSafe(l.fill.to)}); -webkit-background-clip: text; background-clip: text; color: transparent; -webkit-text-fill-color: transparent; }`
    )
  }
  return rules.join('\n')
}

function compileLayer(l: DesignLayer, index: number): LayerOut {
  const sel = `.dz-l${index}`
  const cssParts: string[] = [layerPlacementCss(sel, l)]
  let inner = ''
  let count = 1

  const preset = animPreset(l.anim?.preset)
  const split = l.kind === 'text' && preset?.split ? preset.split : 'none'

  if (l.kind === 'text') {
    const res = splitTextHtml(l.text, split)
    inner = res.html
    count = res.count
    cssParts.push(textContentCss(sel, l, split !== 'none'))
    if (split !== 'none') {
      cssParts.push(`${sel} .dz-w { display: inline-block; white-space: nowrap; }`)
      cssParts.push(`${sel} .dz-c { display: inline-block; }`)
    }
  } else if (l.kind === 'shape') {
    const def = shapeDef(l.shape)
    if (def.kind === 'svg') {
      inner = shapeSvgMarkup(l, `dzg${index}`)
      cssParts.push(`${sel} .dz-s { display: block; }`)
    } else {
      inner = `<div class="dz-s"></div>`
      cssParts.push(`${sel} .dz-s { ${shapeCssDecls(l)} }`)
    }
    cssParts.push(`${sel} .dz-a { display: block; }`)
  } else {
    inner = `<img class="dz-s" src="${escapeAttr(l.src)}" alt="">`
    cssParts.push(
      `${sel} .dz-s { display: block; width: ${l.width}px; height: ${l.height}px; object-fit: ${l.fit}; border-radius: ${l.radius}px; }`
    )
    cssParts.push(`${sel} .dz-a { display: block; }`)
  }

  /* ---- animation ---- */
  let animCss = ''
  let entranceEnd = 0
  let loopPeriod = 0
  if (preset && l.anim) {
    const a = l.anim
    const stagger = a.stagger ?? preset.defaults.stagger ?? 0
    const isSplit = split !== 'none'
    const end = preset.infinite
      ? 0
      : a.delay + a.duration + (isSplit ? stagger * Math.max(0, count - 1) : 0)
    const fillColors =
      l.kind === 'image'
        ? { from: '#ffffff', to: '#9d6bff' }
        : l.fill.kind === 'gradient'
          ? { from: l.fill.from, to: l.fill.to }
          : { from: l.fill.color, to: l.fill.color }
    const ctx: AnimCtx = {
      sel: isSplit ? `${sel} .dz-c` : `${sel} .dz-a`,
      layerSel: sel,
      kf: `dz${index}`,
      dur: a.duration,
      delay: a.delay,
      stagger,
      count,
      ease: easingValue(a.easing),
      dir: a.dir,
      entranceEnd: end,
      colors: { from: cssSafe(fillColors.from), to: cssSafe(fillColors.to) },
    }
    animCss = preset.css(ctx).trim()
    if (preset.infinite) loopPeriod = a.duration
    else entranceEnd = end + (preset.id === 'typewriter' ? 1.6 : 0)
  }

  return {
    html: `<div class="dz-l dz-l${index}"><div class="dz-a">${inner}</div></div>`,
    css: cssParts.join('\n'),
    animCss,
    entranceEnd,
    loopPeriod,
  }
}

/* ------------------------------------------------------------------ */
/* document compilation                                                */
/* ------------------------------------------------------------------ */

export function autoDuration(entranceMax: number, periodMax: number): number {
  const base = Math.max(entranceMax > 0 ? entranceMax + 0.5 : 0, periodMax, 1.5)
  let dur: number
  if (periodMax > 0) {
    // whole number of loop periods → infinite animations wrap seamlessly
    dur = Math.ceil((base - 0.001) / periodMax) * periodMax
  } else {
    dur = Math.ceil(base * 2) / 2
  }
  return Math.min(MAX_LOOP, round2(dur))
}

export function compileDesign(design: DesignDoc): CompiledDesign {
  const warnings: string[] = []
  const visible = design.layers.filter((l) => !l.hidden)

  const outs = visible.map((l, i) => compileLayer(l, i))

  for (const l of visible) {
    if (l.kind === 'image' && !l.src.trim())
      warnings.push(`Image layer "${l.name}" has no URL — it will render empty.`)
    if (l.anim && !animPreset(l.anim.preset))
      warnings.push(`Layer "${l.name}" uses unknown animation "${l.anim.preset}".`)
  }

  const cssParts: string[] = []
  cssParts.push(
    `.dz, .dz * { box-sizing: border-box; margin: 0; padding: 0; }`,
    `.dz { position: relative; width: ${design.width}px; height: ${design.height}px; overflow: hidden; }`
  )
  const bg = design.background
  if (bg.kind !== 'none') {
    const paint =
      bg.kind === 'solid'
        ? cssSafe(bg.color)
        : `linear-gradient(${bg.angle}deg, ${cssSafe(bg.from)}, ${cssSafe(bg.to)})`
    cssParts.push(
      `.dz-bg { position: absolute; inset: 0; background: ${paint};${bg.radius ? ` border-radius: ${bg.radius}px;` : ''} }`
    )
  }
  for (const o of outs) cssParts.push(o.css)
  for (const o of outs) if (o.animCss) cssParts.push(o.animCss)

  const entranceMax = Math.max(0, ...outs.map((o) => o.entranceEnd))
  const periodMax = Math.max(0, ...outs.map((o) => o.loopPeriod))
  const animated = outs.some((o) => o.animCss)
  const duration =
    design.duration === 'auto'
      ? animated
        ? autoDuration(entranceMax, periodMax)
        : 0.5
      : Math.min(MAX_LOOP, Math.max(0.1, design.duration))

  const html =
    `<div class="dz">` +
    (bg.kind !== 'none' ? `<div class="dz-bg"></div>` : '') +
    outs.map((o) => o.html).join('') +
    `</div>`

  return {
    html,
    css: cssParts.join('\n'),
    duration,
    width: design.width,
    height: design.height,
    fontFamily: design.fontFamily,
    animated,
    warnings,
  }
}

/** The visual-item patch a compiled design maps to. */
export function designToItemPatch(design: DesignDoc): Record<string, any> {
  const compiled = compileDesign(design)
  return {
    text: undefined,
    html: compiled.html,
    width: compiled.width,
    height: compiled.height,
    style: { fontFamily: compiled.fontFamily },
    customCode: {
      css: compiled.css,
      animationDuration: compiled.duration,
    },
    designer: JSON.parse(JSON.stringify(design)),
  }
}

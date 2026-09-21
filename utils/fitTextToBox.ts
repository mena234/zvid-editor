/**
 * Editor port of package/src/lib/texts/fitTextToBox.ts.
 *
 * `fitToBox` scales a TEXT element's typography down by a single factor (floor
 * 0.5) just enough that its painted glyphs stay inside the declared box. The
 * renderer clips the screenshot to item.width/height, so without it a template
 * only works for one length of copy. Factor 1 leaves the DOM untouched, so an
 * item that already fits previews exactly as it did before this existed.
 *
 * Fit is judged on painted ink (canvas actualBoundingBox* metrics), not on
 * layout boxes — a text node's client rect is its inline box (font ascent +
 * descent) and over-reports display type by ~50%.
 *
 * Measurement runs on a transform-free copy in an offscreen host: the stage
 * applies scale/rotate/xfade transforms above the item, and client rects of a
 * rotated box are axis-aligned bounds, which would distort the ratio. The
 * factor is then applied to the live element, whose CSS is identical.
 */

/** Below this the design stops being the design; accept the cut instead. */
export const FIT_MIN_SCALE = 0.5
/** Sub-pixel slack: under this an "overflow" is rounding, not a cut. */
export const FIT_EPSILON = 0.5
/** Binary-search steps; 6 lands within ~0.8% of the largest fitting factor. */
export const FIT_SEARCH_STEPS = 6
/**
 * A fixed negative margin (or any offset that does not scale with the type)
 * produces the same overflow at every factor. Only shrink when the floor
 * actually buys something.
 */
export const FIT_MIN_IMPROVEMENT = 0.8

export const FIT_PROPS = [
  'font-size',
  'line-height',
  'letter-spacing',
  'word-spacing',
] as const

export interface FitBox {
  width: number | null
  height: number | null
}

/** TEXT items only, and only when they opted in. */
export function wantsFit(item?: Record<string, any> | null): boolean {
  return (
    !!item &&
    String(item.type ?? '').toUpperCase() === 'TEXT' &&
    item.fitToBox === true
  )
}

/** The declared box the renderer clips to — `null` per undeclared axis. */
export function fitBoxOf(item?: Record<string, any> | null): FitBox {
  const width =
    typeof item?.width === 'number' && item.width > 0 ? item.width : null
  const height =
    typeof item?.height === 'number' && item.height > 0 ? item.height : null
  return { width, height }
}

/** True when this item should be fitted at all (opted in + a declared axis). */
export function fitActiveFor(item?: Record<string, any> | null): boolean {
  if (!wantsFit(item)) return false
  const box = fitBoxOf(item)
  return !!(box.width || box.height)
}

/**
 * What `white-space` resolves to on the renderer's `.container`.
 *
 * HTML keeps the initial `normal`; plain text explicitly uses `pre-wrap` so
 * authored line breaks and spaces survive. An item's own style wins in both.
 */
export const RENDERER_WHITE_SPACE = 'normal'

/** The value the renderer's container ends up with for this item. */
export function rendererWhiteSpaceFor(item?: Record<string, any> | null): string {
  // buildHtmlContent kebab-cases the style keys, so a payload may declare
  // either spelling and the renderer honours both.
  const declared = item?.style?.whiteSpace ?? item?.style?.['white-space']
  const value = typeof declared === 'string' ? declared.trim() : ''
  return value || (item?.html ? RENDERER_WHITE_SPACE : 'pre-wrap')
}

/**
 * Pin a measured copy to the renderer's `white-space` — measurement only.
 *
 * This includes the plain-text/HTML distinction and explicit style overrides,
 * so fitting measures the same line breaks that will be captured.
 */
export function applyRendererWhiteSpace(
  el: HTMLElement | null | undefined,
  item?: Record<string, any> | null
): void {
  // `important` so the `.text-inner` class rule cannot win it back.
  el?.style?.setProperty('white-space', rendererWhiteSpaceFor(item), 'important')
}

/**
 * The whole algorithm, self-contained on purpose: it also runs inside the
 * sandboxed customCode iframe, which is a separate document that cannot import
 * anything — `fitScriptSource()` serializes this very function into it. Keep it
 * free of module-scope references (every constant arrives through `opts`).
 */
export function fitRoutine(container: any, opts: any): number {
  if (!container) return 1
  var width = opts.width || 0
  var height = opts.height || 0
  if (!width && !height) return 1
  var minScale = opts.minScale
  var epsilon = opts.epsilon
  var steps = opts.steps
  var minImprovement = opts.minImprovement
  var originLeft = opts.originLeft || 0
  var originTop = opts.originTop || 0

  var PROPS = ['font-size', 'line-height', 'letter-spacing', 'word-spacing']

  var nodes = [container]
  var descendants = container.querySelectorAll('*')
  for (var d = 0; d < descendants.length; d++) nodes.push(descendants[d])

  var px = function (value: any) {
    return value === 'normal' || value === '' || value == null
      ? null
      : parseFloat(value)
  }

  // Snapshot the author's own inline declarations so factor 1 restores them
  // exactly (setProperty writes into the same declaration block, so a plain
  // removeProperty would delete an inline font-size coming from the html).
  var base: any[] = []
  for (var n = 0; n < nodes.length; n++) {
    var el = nodes[n]
    var cs = getComputedStyle(el)
    var inline: any = {}
    for (var p = 0; p < PROPS.length; p++) {
      inline[PROPS[p]] = [
        el.style.getPropertyValue(PROPS[p]),
        el.style.getPropertyPriority(PROPS[p]),
      ]
    }
    base.push({
      el: el,
      inline: inline,
      values: {
        'font-size': px(cs.fontSize),
        'line-height': px(cs.lineHeight),
        'letter-spacing': px(cs.letterSpacing),
        'word-spacing': px(cs.wordSpacing),
      },
    })
  }

  var restore = function () {
    for (var i = 0; i < base.length; i++) {
      for (var j = 0; j < PROPS.length; j++) {
        base[i].el.style.removeProperty(PROPS[j])
        var decl = base[i].inline[PROPS[j]]
        if (decl[0]) base[i].el.style.setProperty(PROPS[j], decl[0], decl[1])
      }
    }
  }

  var applyFactor = function (factor: number) {
    if (factor === 1) return restore()
    for (var i = 0; i < base.length; i++) {
      for (var j = 0; j < PROPS.length; j++) {
        var value = base[i].values[PROPS[j]]
        if (value == null || !isFinite(value)) continue
        // `important` so a customCode rule (or an animation) cannot re-inflate
        // the type after it has been fitted.
        base[i].el.style.setProperty(
          PROPS[j],
          value * factor + 'px',
          'important'
        )
      }
    }
  }

  var measureCtx: any = null
  try {
    measureCtx = document.createElement('canvas').getContext('2d')
  } catch (e) {
    measureCtx = null
  }

  // Painted extent of everything inside the container, relative to the box the
  // renderer clips to (its top-left corner is the clip origin).
  var inkBox = function () {
    var box: any = null
    var add = function (l: number, t: number, r: number, b: number) {
      if (!(r > l) || !(b > t)) return
      box = box
        ? {
            left: Math.min(box.left, l),
            top: Math.min(box.top, t),
            right: Math.max(box.right, r),
            bottom: Math.max(box.bottom, b),
          }
        : { left: l, top: t, right: r, bottom: b }
    }

    var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
    var node: any
    while ((node = walker.nextNode())) {
      var text = (node.nodeValue || '').trim()
      if (!text) continue
      var range = document.createRange()
      range.selectNodeContents(node)
      var rects: any = range.getClientRects()
      var lines: any[] = []
      for (var r = 0; r < rects.length; r++) lines.push(rects[r])
      if (!lines.length) lines.push(range.getBoundingClientRect())
      var parent = node.parentElement
      var pcs = parent ? getComputedStyle(parent) : null
      var metrics: any = null
      if (pcs && measureCtx) {
        try {
          measureCtx.font =
            pcs.fontStyle +
            ' ' +
            pcs.fontWeight +
            ' ' +
            pcs.fontSize +
            ' ' +
            pcs.fontFamily
          if ('letterSpacing' in measureCtx) {
            measureCtx.letterSpacing =
              pcs.letterSpacing === 'normal' ? '0px' : pcs.letterSpacing
          }
          metrics = measureCtx.measureText(text)
        } catch (e) {
          metrics = null
        }
      }
      for (var k = 0; k < lines.length; k++) {
        var rect = lines[k]
        var left = rect.left - originLeft
        var top = rect.top - originTop
        if (metrics && isFinite(metrics.fontBoundingBoxAscent)) {
          var fbAscent = metrics.fontBoundingBoxAscent
          var fbDescent = metrics.fontBoundingBoxDescent
          var fbHeight = fbAscent + fbDescent || 1
          var ascent = Math.min(metrics.actualBoundingBoxAscent, fbAscent)
          var descent = Math.min(metrics.actualBoundingBoxDescent, fbDescent)
          var baseline =
            top +
            (rect.height >= fbHeight - 1 && rect.height <= fbHeight + 1
              ? fbAscent
              : (rect.height * fbAscent) / fbHeight)
          add(left, baseline - ascent, left + rect.width, baseline + descent)
        } else {
          add(left, top, left + rect.width, top + rect.height)
        }
      }
    }

    // A background, border or image paints its whole box, so those count as ink
    // even where no glyph lands.
    var painted = container.querySelectorAll('*')
    for (var q = 0; q < painted.length; q++) {
      var pel = painted[q]
      var pcs2 = getComputedStyle(pel)
      var paints =
        (pcs2.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
          pcs2.backgroundColor !== 'transparent') ||
        pcs2.backgroundImage !== 'none' ||
        parseFloat(pcs2.borderTopWidth) > 0 ||
        parseFloat(pcs2.borderBottomWidth) > 0 ||
        parseFloat(pcs2.borderLeftWidth) > 0 ||
        parseFloat(pcs2.borderRightWidth) > 0 ||
        pel.tagName === 'IMG' ||
        pel.tagName === 'SVG'
      if (!paints) continue
      var prect = pel.getBoundingClientRect()
      add(
        prect.left - originLeft,
        prect.top - originTop,
        prect.left - originLeft + prect.width,
        prect.top - originTop + prect.height
      )
    }
    return box
  }

  var overflow = function () {
    var box = inkBox()
    if (!box) return 0
    var worst = 0
    if (width) worst = Math.max(worst, box.right - width, -box.left)
    if (height) worst = Math.max(worst, box.bottom - height, -box.top)
    return worst
  }

  var atFullSize = overflow()
  if (atFullSize <= epsilon) return 1

  applyFactor(minScale)
  var atFloor = overflow()
  if (atFloor > epsilon && atFloor > atFullSize * minImprovement) {
    // The overflow does not scale with the type (a fixed offset, an unbreakable
    // rule), so shrinking would only make the design smaller without fixing it.
    restore()
    return 1
  }
  if (atFloor > epsilon) return minScale

  var low = minScale
  var high = 1
  for (var s = 0; s < steps; s++) {
    var mid = (low + high) / 2
    applyFactor(mid)
    if (overflow() <= epsilon) low = mid
    else high = mid
  }
  applyFactor(low)
  return low
}

interface FitRestoreEntry {
  el: HTMLElement
  /** the author's own inline declaration, `[value, priority]` */
  inline: Record<string, [string, string]>
  /** what this module wrote, so a foreign write is recognisable */
  written: Record<string, string>
}

/** What the last apply wrote, so the next one starts from the author's CSS. */
const applied = new WeakMap<HTMLElement, FitRestoreEntry[]>()

/**
 * Apply an already-computed factor to a live element (and its descendants),
 * restoring whatever a previous apply wrote first so repeated runs never
 * compound. `factor >= 1` only restores: the DOM ends up byte-identical to an
 * item that never asked to be fitted.
 */
export function applyFitFactor(container: HTMLElement, factor: number): void {
  const previous = applied.get(container)
  if (previous) {
    applied.delete(container)
    for (const entry of previous) {
      for (const prop of FIT_PROPS) {
        // Only undo declarations still owned by the last apply. Vue re-patches
        // the container's inline style when the item's style object changes,
        // and that fresh value must win over our stale snapshot.
        if (
          entry.el.style.getPropertyValue(prop) !== entry.written[prop] ||
          entry.el.style.getPropertyPriority(prop) !== 'important'
        )
          continue
        entry.el.style.removeProperty(prop)
        const decl = entry.inline[prop]
        if (decl && decl[0]) entry.el.style.setProperty(prop, decl[0], decl[1])
      }
    }
  }
  if (!isFinite(factor) || factor >= 1) return

  const nodes: HTMLElement[] = [
    container,
    ...Array.from(container.querySelectorAll<HTMLElement>('*')),
  ]
  const snapshot: FitRestoreEntry[] = []
  for (const el of nodes) {
    const cs = getComputedStyle(el)
    const inline: Record<string, [string, string]> = {}
    for (const prop of FIT_PROPS) {
      inline[prop] = [
        el.style.getPropertyValue(prop),
        el.style.getPropertyPriority(prop),
      ]
    }
    const written: Record<string, string> = {}
    snapshot.push({ el, inline, written })
    const resolved: Record<string, string> = {
      'font-size': cs.fontSize,
      'line-height': cs.lineHeight,
      'letter-spacing': cs.letterSpacing,
      'word-spacing': cs.wordSpacing,
    }
    for (const prop of FIT_PROPS) {
      const raw = resolved[prop]
      if (raw == null || raw === '' || raw === 'normal') continue
      const value = parseFloat(raw)
      if (!isFinite(value)) continue
      // `important` so a customCode rule (or an animation) cannot re-inflate
      // the type after it has been fitted.
      const next = `${value * factor}px`
      el.style.setProperty(prop, next, 'important')
      written[prop] = el.style.getPropertyValue(prop) || next
    }
  }
  applied.set(container, snapshot)
}

/**
 * Measure the fit factor on a transform-free copy. `mount` receives an
 * offscreen host pinned at the viewport origin and returns the container to
 * measure; the host is torn down before this returns.
 */
export function measureFitFactor(
  mount: (host: HTMLElement) => HTMLElement | null,
  box: FitBox
): number {
  if (typeof document === 'undefined' || !document.body) return 1
  if (!box.width && !box.height) return 1
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  // `fixed` pins the host at the viewport origin (so measured coordinates are
  // the renderer's clip coordinates) and makes it the containing block for the
  // absolutely positioned copy inside it. `white-space` is declared so the copy
  // inherits what the renderer's capture page inherits (`normal`) instead of
  // whatever the editor page happens to set above it.
  host.style.cssText =
    'position:fixed;left:0;top:0;width:8000px;height:6000px;overflow:hidden;' +
    'visibility:hidden;pointer-events:none;z-index:-2147483647;' +
    `white-space:${RENDERER_WHITE_SPACE};`
  document.body.appendChild(host)
  try {
    const container = mount(host)
    if (!container) return 1
    const origin = host.getBoundingClientRect()
    return fitRoutine(container, {
      width: box.width,
      height: box.height,
      minScale: FIT_MIN_SCALE,
      epsilon: FIT_EPSILON,
      steps: FIT_SEARCH_STEPS,
      minImprovement: FIT_MIN_IMPROVEMENT,
      originLeft: origin.left,
      originTop: origin.top,
    })
  } catch {
    // Fitting is an enhancement: an element that cannot be probed still renders.
    return 1
  } finally {
    host.remove()
  }
}

/**
 * The routine serialized for the sandboxed iframe, which owns its own document
 * (and therefore its own layout, unaffected by the stage transform — origin 0,0
 * exactly like the renderer's capture page).
 */
export function fitScriptSource(box: FitBox): string {
  const opts = {
    width: box.width,
    height: box.height,
    minScale: FIT_MIN_SCALE,
    epsilon: FIT_EPSILON,
    steps: FIT_SEARCH_STEPS,
    minImprovement: FIT_MIN_IMPROVEMENT,
    originLeft: 0,
    originTop: 0,
  }
  return `try{(${String(fitRoutine)})(document.querySelector('.container'),${JSON.stringify(
    opts
  )})}catch(e){console.error(e)}`
}

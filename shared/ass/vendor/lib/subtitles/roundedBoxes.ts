import type { Caption, Subtitle, SubtitleStyles, Word } from '../../types/text'
import { formatTime } from '../../utils/subtitles'
import { wrapWordIndicesByWidth } from '../../utils/textWrappingMeasurement'
import { convertColor } from './content/generateStyles'
import configInstance from '../config/config'
import { loadRenderFont } from '../../../fontMetrics'

/**
 * Browser port of package/src/lib/subtitles/roundedBoxes.ts — keep the
 * geometry/layout code in lockstep with the package. Only the font metrics
 * source differs: the package downloads the TTF and measures with
 * @napi-rs/canvas; here shared/ass/fontMetrics.ts fetches the same TTF via
 * /api/fonts, registers it as a FontFace, and a DOM canvas measures at the
 * same libass em size (fontSize x upem / (winAscent + winDescent)).
 */

/** Modes whose active word is restyled via {\rHighlight} (box-able). */
const ACTIVE_BOX_MODES = new Set([
  'progressive',
  'karaoke',
  'highlight',
  'pop',
  'bounce',
  'one-word',
])

const SCALE_HEADROOM: Record<string, number> = { pop: 1.3, bounce: 1.35 }

export interface RoundedBoxes {
  /** Style lines to append to the [V4+ Styles] section. */
  styleLines: string[]
  /** Dialogue lines (drawings) that must precede the text events. */
  events: string
  /** styles with the square-box fields stripped for the text rendering. */
  stylesForText: SubtitleStyles
}

/* ---------------- font metrics ---------------- */

interface FontMetrics {
  /** measure a string in libass-rendered pixels at the given Fontsize */
  measure: (text: string) => number
}

async function loadFontMetrics(styles: SubtitleStyles): Promise<FontMetrics> {
  const fontSize = styles.fontSize ?? 50
  const family = String(styles.fontFamily ?? 'Poppins')
    .split(',')[0]
    .trim()

  const loaded = await loadRenderFont(family, {
    weight: styles.isBold ? 700 : 400,
    italic: !!styles.isItalic,
  })

  const scale = loaded?.scale ?? 1000 / 1400 // same fallback as the package
  const cssFamily = loaded?.alias ?? 'sans-serif'
  const emPx = fontSize * scale

  if (typeof document === 'undefined') {
    return { measure: (text: string) => text.length * emPx * 0.6 }
  }
  const ctx = document.createElement('canvas').getContext('2d')!
  ctx.font = `${emPx}px "${cssFamily}"`
  return { measure: (text: string) => ctx.measureText(text).width }
}

/* ---------------- drawing ---------------- */

const round1 = (v: number) => Math.round(v * 10) / 10

/** ASS vector path of a rounded rectangle (clockwise, cubic corners). */
export function roundedRectPath(
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number
): string {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2))
  if (r < 0.5) {
    return `m ${round1(x)} ${round1(y)} l ${round1(x + w)} ${round1(y)} ${round1(x + w)} ${round1(y + h)} ${round1(x)} ${round1(y + h)}`
  }
  const k = 0.5523 * r
  const p = (vx: number, vy: number) => `${round1(vx)} ${round1(vy)}`
  return [
    `m ${p(x + r, y)}`,
    `l ${p(x + w - r, y)}`,
    `b ${p(x + w - r + k, y)} ${p(x + w, y + r - k)} ${p(x + w, y + r)}`,
    `l ${p(x + w, y + h - r)}`,
    `b ${p(x + w, y + h - r + k)} ${p(x + w - r + k, y + h)} ${p(x + w - r, y + h)}`,
    `l ${p(x + r, y + h)}`,
    `b ${p(x + r - k, y + h)} ${p(x, y + h - r + k)} ${p(x, y + h - r)}`,
    `l ${p(x, y + r)}`,
    `b ${p(x, y + r - k)} ${p(x + r - k, y)} ${p(x + r, y)}`,
  ].join(' ')
}

function boxDialogue(
  style: string,
  start: number,
  end: number,
  path_: string
): string {
  return `Dialogue: 0,${formatTime(start)},${formatTime(end)},${style},,0,0,0,,{\\pos(0,0)\\an7\\p1}${path_}{\\p0}\n`
}

function boxStyleLine(name: string, color: string, fontName: string): string {
  // Only PrimaryColour matters — the event is a filled drawing. The font is
  // never rasterized, but libass still resolves it: use the subtitle's own
  // family so environments without system fonts (libass WASM) need no extra
  // fallback font.
  return `Style: ${name},${fontName},20,${convertColor(color)},&Hff000000,&Hff000000,&Hff000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`
}

/* ---------------- layout ---------------- */

interface LineLayout {
  /** left edge (px) of the line's text */
  left: number
  /** top (px) of the line's cell (cell height = fontSize) */
  top: number
  width: number
  words: Word[]
  /** prefix advance (px) of each word within the line */
  wordX: number[]
  wordW: number[]
}

/** Lay out one displayed group into lines, mirroring libass placement. */
function layoutGroup(
  texts: string[],
  words: Word[],
  styles: SubtitleStyles,
  metrics: FontMetrics,
  mode: string,
  playResX: number,
  playResY: number
): LineLayout[] {
  const fontSize = styles.fontSize ?? 50
  const marginH = styles.marginH ?? 0
  const marginV = styles.marginV ?? 0
  const [vertical = 'bottom', horizontal = 'center'] = (
    styles.position || 'bottom-center'
  ).split('-')
  const wrapWidth = playResX - 2 * marginH

  // Line grouping. pop/bounce hard-wrap their own lines via \q2 + \N (using
  // the uncalibrated measurement + scale headroom) — replicate exactly so the
  // boxes match those breaks. Everything else wraps greedily by libass
  // (WrapStyle: 1), predicted with the calibrated measurement.
  let lineIdx: number[][]
  if (SCALE_HEADROOM[mode]) {
    lineIdx = wrapWordIndicesByWidth(texts, wrapWidth, fontSize, styles.fontFamily ?? 'Poppins', {
      isBold: styles.isBold,
      isItalic: styles.isItalic,
      scaleHeadroom: SCALE_HEADROOM[mode],
    })
  } else {
    lineIdx = []
    let current: number[] = []
    texts.forEach((_, i) => {
      const candidate = [...current, i]
      const w = metrics.measure(candidate.map((j) => texts[j]).join(' '))
      if (w > wrapWidth && current.length > 0) {
        lineIdx.push(current)
        current = [i]
      } else {
        current = candidate
      }
    })
    if (current.length) lineIdx.push(current)
  }

  const n = lineIdx.length
  const blockTop =
    vertical === 'top'
      ? marginV
      : vertical === 'center'
        ? (playResY - n * fontSize) / 2
        : playResY - marginV - n * fontSize

  return lineIdx.map((idxs, li) => {
    const lineTexts = idxs.map((i) => texts[i])
    const width = metrics.measure(lineTexts.join(' '))
    const left =
      horizontal === 'left'
        ? marginH
        : horizontal === 'right'
          ? playResX - marginH - width
          : (playResX - width) / 2
    const wordX: number[] = []
    const wordW: number[] = []
    idxs.forEach((i, k) => {
      const prefix = lineTexts.slice(0, k).join(' ')
      wordX.push(k === 0 ? 0 : metrics.measure(`${prefix} `))
      wordW.push(metrics.measure(texts[i]))
    })
    return {
      left,
      top: blockTop + li * fontSize,
      width,
      words: idxs.map((i) => words[i]),
      wordX,
      wordW,
    }
  })
}

/* ---------------- main ---------------- */

/**
 * Plan rounded box drawings for a normalized subtitle. Returns null when no
 * radius is requested (the square BorderStyle path stays byte-identical).
 */
export default async function prepareRoundedBoxes(
  subtitle: Subtitle
): Promise<RoundedBoxes | null> {
  const styles = (subtitle.styles ?? {}) as SubtitleStyles
  const mode = styles.mode ?? 'normal'

  const wantBgBox =
    !!styles.background && (styles.backgroundRadius ?? 0) > 0
  const wantActiveBox =
    !!styles.activeWord?.background &&
    (styles.activeWord.radius ?? 0) > 0 &&
    ACTIVE_BOX_MODES.has(mode)
  if (!wantBgBox && !wantActiveBox) return null

  const { width: playResX, height: playResY } = configInstance.getConfig()
  const metrics = await loadFontMetrics(styles)
  const fontSize = styles.fontSize ?? 50
  const pad = Math.max(0, styles.backgroundPadding ?? 0)
  const bgRadius = styles.backgroundRadius ?? 0
  const activeRadius = styles.activeWord?.radius ?? 0

  let events = ''

  for (let ci = 0; ci < subtitle.captions.length; ci++) {
    const caption = subtitle.captions[ci] as Caption
    const words = caption.words ?? []
    const isWordMode = mode !== 'normal' && mode !== 'none'
    const texts = isWordMode
      ? words.map((w) => w.text)
      : String(caption.text ?? '')
          .split(/\s+/)
          .filter(Boolean)
    if (!texts.length) continue
    if (isWordMode && !words.length) continue

    // ---- display window of this group ----
    let start = isWordMode ? words[0].start : caption.start
    let end = isWordMode ? words[words.length - 1].end : caption.end
    if (mode === 'slide') {
      // slide clamps each caption to the next caption's first visibility
      const next = subtitle.captions[ci + 1]
      const nextVisible = next
        ? next.words?.length
          ? next.words[0].start
          : next.start
        : Infinity
      start = words.length ? words[0].start : caption.start
      end = Math.min(caption.end, nextVisible)
      if (end <= start) continue
    }

    if (mode === 'one-word') {
      // each word is its own single-word "line"
      if (wantBgBox) {
        for (const w of words) {
          const line = layoutGroup([w.text], [w], styles, metrics, mode, playResX, playResY)[0]
          events += boxDialogue(
            'ZvidBoxBg',
            w.start,
            w.end,
            roundedRectPath(line.left - pad, line.top - pad, line.width + 2 * pad, fontSize + 2 * pad, bgRadius)
          )
        }
      }
      if (wantActiveBox) {
        for (const w of words) {
          const line = layoutGroup([w.text], [w], styles, metrics, mode, playResX, playResY)[0]
          events += boxDialogue(
            'ZvidBoxActive',
            w.start,
            w.end,
            roundedRectPath(line.left - pad, line.top - pad, line.width + 2 * pad, fontSize + 2 * pad, activeRadius)
          )
        }
      }
      continue
    }

    const lines = layoutGroup(texts, words, styles, metrics, mode, playResX, playResY)

    if (wantBgBox) {
      for (const line of lines) {
        events += boxDialogue(
          'ZvidBoxBg',
          start,
          end,
          roundedRectPath(line.left - pad, line.top - pad, line.width + 2 * pad, fontSize + 2 * pad, bgRadius)
        )
      }
    }

    if (wantActiveBox && isWordMode) {
      const groupEnd = words[words.length - 1].end
      let flatIndex = 0
      for (const line of lines) {
        for (let k = 0; k < line.words.length; k++, flatIndex++) {
          const w = line.words[k]
          const nextStart =
            flatIndex < words.length - 1 ? words[flatIndex + 1].start : groupEnd
          events += boxDialogue(
            'ZvidBoxActive',
            w.start,
            nextStart,
            roundedRectPath(
              line.left + line.wordX[k] - pad,
              line.top - pad,
              line.wordW[k] + 2 * pad,
              fontSize + 2 * pad,
              activeRadius
            )
          )
        }
      }
    }
  }

  // strip the square-box fields the drawings replace
  const stylesForText: SubtitleStyles = { ...styles }
  if (wantBgBox) {
    delete stylesForText.background
    delete stylesForText.backgroundPadding
    delete stylesForText.backgroundRadius
  }
  if (wantActiveBox && stylesForText.activeWord) {
    const { background: _bg, radius: _r, ...rest } = stylesForText.activeWord
    stylesForText.activeWord = Object.keys(rest).length ? rest : undefined
  }

  const boxFont = String(styles.fontFamily ?? 'Poppins').split(',')[0].trim()
  const styleLines: string[] = []
  if (wantBgBox)
    styleLines.push(boxStyleLine('ZvidBoxBg', styles.background as string, boxFont))
  if (wantActiveBox)
    styleLines.push(boxStyleLine('ZvidBoxActive', styles.activeWord!.background as string, boxFont))

  return { styleLines, events, stylesForText }
}

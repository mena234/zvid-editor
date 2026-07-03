import type { RawSubtitle, RawCaption, RawWord } from '~/shared/schema/types'

/**
 * Runtime helpers approximating the package's ASS subtitle output
 * (lib/subtitles/*) for the stage preview.
 */

export function activeCaptionAt(
  subtitle: RawSubtitle | undefined,
  t: number
): { caption: RawCaption; index: number } | null {
  const captions = subtitle?.captions ?? []
  for (let i = 0; i < captions.length; i++) {
    const c = captions[i]
    if (t >= c.start && t < c.end) return { caption: c, index: i }
  }
  return null
}

export function activeWordIndex(caption: RawCaption, t: number): number {
  const words = caption.words ?? []
  for (let i = words.length - 1; i >= 0; i--) {
    if (t >= words[i].start) return i
  }
  return -1
}

export interface RenderedWord {
  text: string
  active: boolean
  visible: boolean
}

/**
 * mode semantics (lib/subtitles/modes):
 *  - normal: full caption text, no per-word treatment
 *  - karaoke: full text, the word being spoken is highlighted
 *  - one-word: only the word being spoken is shown
 *  - progressive: words appear as they are spoken and stay
 */
export function renderCaptionWords(
  caption: RawCaption,
  t: number,
  mode: string
): RenderedWord[] {
  const words: RawWord[] =
    caption.words?.length > 0
      ? caption.words
      : (caption.text ?? '')
          .split(/\s+/)
          .filter(Boolean)
          .map((w) => ({ start: caption.start, end: caption.end, text: w }))

  const idx = activeWordIndex(caption, t)

  return words.map((w, i) => {
    switch (mode) {
      case 'one-word':
        return { text: w.text, active: i === idx, visible: i === idx }
      case 'progressive':
        return { text: w.text, active: i === idx, visible: i <= idx }
      case 'karaoke':
        return { text: w.text, active: i === idx, visible: true }
      default:
        return { text: w.text, active: false, visible: true }
    }
  })
}

/** CSS placement mirroring mapPositionToASS + marginV/marginH. */
export function subtitleContainerStyle(
  styles: Record<string, any> | undefined,
  projectWidth: number,
  projectHeight: number
): Record<string, string> {
  const pos = styles?.position ?? 'bottom-center'
  const marginV = styles?.marginV ?? 40
  const marginH = styles?.marginH ?? 40

  const s: Record<string, string> = {
    position: 'absolute',
    display: 'flex',
    left: `${marginH}px`,
    right: `${marginH}px`,
    pointerEvents: 'none',
  }
  if (pos.startsWith('top')) s.top = `${marginV}px`
  else if (pos.startsWith('center')) {
    s.top = '50%'
    s.transform = 'translateY(-50%)'
  } else s.bottom = `${marginV}px`

  if (pos.endsWith('left')) s.justifyContent = 'flex-start'
  else if (pos.endsWith('right')) s.justifyContent = 'flex-end'
  else s.justifyContent = 'center'
  return s
}

export function subtitleTextStyle(
  styles: Record<string, any> | undefined
): Record<string, string> {
  const fontSize = styles?.fontSize ?? 48
  const outline = styles?.outline
  const s: Record<string, string> = {
    fontFamily: `'${styles?.fontFamily ?? 'Poppins'}', sans-serif`,
    fontSize: `${fontSize}px`,
    fontWeight: styles?.isBold ? '700' : '400',
    fontStyle: styles?.isItalic ? 'italic' : 'normal',
    color: styles?.color ?? '#ffffff',
    textAlign: 'center',
    lineHeight: '1.25',
  }
  if (styles?.textTransform) s.textTransform = styles.textTransform
  if (styles?.background) {
    s.background = styles.background
    s.padding = `${Math.round(fontSize * 0.12)}px ${Math.round(fontSize * 0.3)}px`
    s.borderRadius = '6px'
  } else if (outline?.width) {
    const w = outline.width
    const c = outline.color ?? '#000'
    // ASS outline ≈ stroke; approximate with multi-direction text shadow
    s.textShadow = [
      `-${w}px -${w}px 0 ${c}`,
      `${w}px -${w}px 0 ${c}`,
      `-${w}px ${w}px 0 ${c}`,
      `${w}px ${w}px 0 ${c}`,
      `0 ${w}px 0 ${c}`,
      `0 -${w}px 0 ${c}`,
      `${w}px 0 0 ${c}`,
      `-${w}px 0 0 ${c}`,
    ].join(', ')
  }
  return s
}

/* ---------------- SRT / VTT import ---------------- */

function parseTimestamp(ts: string): number {
  const m = ts.trim().match(/(?:(\d+):)?(\d+):(\d+)[.,](\d+)/)
  if (!m) return 0
  const [, h, mm, ss, frac] = m
  return (
    (h ? parseInt(h) * 3600 : 0) +
    parseInt(mm) * 60 +
    parseInt(ss) +
    parseInt(frac.padEnd(3, '0').slice(0, 3)) / 1000
  )
}

/** Parse SRT or VTT into captions with proportionally distributed words. */
export function parseSrtVtt(content: string): RawCaption[] {
  const captions: RawCaption[] = []
  const blocks = content
    .replace(/^WEBVTT.*?\n\n/s, '')
    .replace(/\r/g, '')
    .split(/\n\n+/)

  for (const block of blocks) {
    const lines = block.trim().split('\n')
    if (!lines.length) continue
    let timeLineIdx = lines.findIndex((l) => l.includes('-->'))
    if (timeLineIdx === -1) continue
    const [startStr, endStr] = lines[timeLineIdx].split('-->')
    const start = parseTimestamp(startStr)
    const end = parseTimestamp(endStr)
    const text = lines
      .slice(timeLineIdx + 1)
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .trim()
    if (!text || end <= start) continue
    captions.push({ start, end, text, words: distributeWords(text, start, end) })
  }
  return captions
}

export function distributeWords(text: string, start: number, end: number): RawWord[] {
  const parts = text.split(/\s+/).filter(Boolean)
  if (!parts.length) return []
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

/** Whisper-style JSON (segments/words with start/end) → captions. */
export function parseWhisperJson(raw: any): RawCaption[] {
  const captions: RawCaption[] = []
  const segments = raw?.segments ?? (Array.isArray(raw) ? raw : null)
  if (!segments) return captions
  for (const seg of segments) {
    const words: RawWord[] = (seg.words ?? []).map((w: any) => ({
      start: Number(w.start ?? w.startTime ?? 0),
      end: Number(w.end ?? w.endTime ?? 0),
      text: String(w.word ?? w.text ?? '').trim(),
    }))
    const start = Number(seg.start ?? words[0]?.start ?? 0)
    const end = Number(seg.end ?? words[words.length - 1]?.end ?? start)
    const text = String(seg.text ?? words.map((w) => w.text).join(' ')).trim()
    if (end <= start) continue
    captions.push({
      start,
      end,
      text,
      words: words.length ? words : distributeWords(text, start, end),
    })
  }
  return captions
}

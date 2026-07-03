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

/* ---------------- unified subtitle import (SRT / VTT / ASS / JSON) ------- */

export interface ParsedSubtitleImport {
  captions: RawCaption[]
  /** subtitle styles recovered from the file (ASS styles; SRT/VTT hints) */
  styles?: Record<string, any>
  format: 'srt' | 'vtt' | 'ass' | 'whisper-json'
}

/**
 * Parse a subtitle file by extension/content. SRT and VTT are converted into
 * the editor's ASS-oriented model (captions + ASS-style `styles`) as far as
 * their formatting hints allow; ASS/SSA imports map the dominant style and
 * `\k` karaoke timing directly.
 */
export function parseSubtitleFile(
  fileName: string,
  content: string
): ParsedSubtitleImport {
  const ext = (fileName.split('.').pop() ?? '').toLowerCase()
  if (ext === 'json') {
    return { captions: parseWhisperJson(JSON.parse(content)), format: 'whisper-json' }
  }
  if (ext === 'ass' || ext === 'ssa' || /^\s*\[script info\]/i.test(content)) {
    return { ...parseAss(content), format: 'ass' }
  }
  const isVtt = ext === 'vtt' || /^﻿?WEBVTT/.test(content)
  const { captions, styles } = parseSrtVttStyled(content)
  return { captions, styles, format: isVtt ? 'vtt' : 'srt' }
}

/** ASS numpad alignment (V4+) → editor subtitle position. 2 = default. */
function assAlignmentToPosition(align: number): string | undefined {
  const map: Record<number, string | undefined> = {
    1: 'bottom-left',
    2: undefined, // bottom-center is the package default
    3: 'bottom-right',
    4: 'center-left',
    5: 'center-center',
    6: 'center-right',
    7: 'top-left',
    8: 'top-center',
    9: 'top-right',
  }
  return map[align]
}

/** legacy SSA alignment (V4): 1-3 bottom, +4 = top title, +8 = mid title */
function ssaLegacyToNumpad(align: number): number {
  const base = ((align - 1) % 4) + 1 // 1..3 left/center/right
  if (align & 4) return base + 6 // toptitle
  if (align & 8) return base + 3 // midtitle
  return base
}

/** &HAABBGGRR& / &HBBGGRR& / decimal → { hex: #rrggbb, alpha: 0..1 opaque } */
function parseAssColor(v: string): { hex: string; alpha: number } | null {
  const m = String(v ?? '')
    .trim()
    .match(/^&H?([0-9a-f]{1,8})&?$/i)
  let num: number
  if (m) num = parseInt(m[1], 16)
  else if (/^-?\d+$/.test(String(v).trim())) {
    num = Number(v)
    if (num < 0) num += 0x100000000
  } else return null
  const a = (num >>> 24) & 0xff // 00 = opaque, FF = transparent
  const b = (num >>> 16) & 0xff
  const g = (num >>> 8) & 0xff
  const r = num & 0xff
  const hx = (n: number) => n.toString(16).padStart(2, '0')
  return { hex: `#${hx(r)}${hx(g)}${hx(b)}`, alpha: 1 - a / 255 }
}

interface AssDialogue {
  start: number
  end: number
  style: string
  text: string
}

/** Parse ASS/SSA content into captions (with `\k` karaoke words) + styles. */
export function parseAss(content: string): {
  captions: RawCaption[]
  styles?: Record<string, any>
} {
  const lines = content.replace(/^﻿/, '').replace(/\r/g, '').split('\n')

  let section = ''
  let styleFormat: string[] = []
  let eventFormat: string[] = []
  let legacySsa = false
  const stylesByName: Record<string, Record<string, string>> = {}
  const dialogues: AssDialogue[] = []

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith(';')) continue
    const sec = line.match(/^\[(.+)\]$/)
    if (sec) {
      section = sec[1].toLowerCase()
      legacySsa = legacySsa || section === 'v4 styles'
      continue
    }
    const kv = line.match(/^([A-Za-z]+)\s*:\s*(.*)$/)
    if (!kv) continue
    const key = kv[1].toLowerCase()
    const value = kv[2]

    if (section.includes('styles')) {
      if (key === 'format') {
        styleFormat = value.split(',').map((f) => f.trim().toLowerCase())
      } else if (key === 'style' && styleFormat.length) {
        const parts = value.split(',').map((p) => p.trim())
        const row: Record<string, string> = {}
        styleFormat.forEach((f, i) => (row[f] = parts[i] ?? ''))
        if (row.name) stylesByName[row.name] = row
      }
    } else if (section === 'events') {
      if (key === 'format') {
        eventFormat = value.split(',').map((f) => f.trim().toLowerCase())
      } else if (key === 'dialogue') {
        const fmt = eventFormat.length
          ? eventFormat
          : ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text']
        const textIdx = fmt.indexOf('text')
        const parts = value.split(',')
        const fields: Record<string, string> = {}
        fmt.forEach((f, i) => {
          if (f !== 'text') fields[f] = (parts[i] ?? '').trim()
        })
        const text = parts.slice(textIdx === -1 ? fmt.length - 1 : textIdx).join(',')
        const start = parseTimestamp(fields.start ?? '')
        const end = parseTimestamp(fields.end ?? '')
        if (end > start) {
          dialogues.push({ start, end, style: fields.style ?? '', text })
        }
      }
    }
  }

  /* captions: strip override tags, honor \k karaoke, drop drawing lines */
  const captions: RawCaption[] = []
  let sawKaraoke = false
  for (const d of dialogues) {
    if (/\\p[1-9]/.test(d.text)) continue // vector drawing, not text
    const parsed = parseAssDialogueText(d.text, d.start, d.end)
    if (!parsed.text) continue
    sawKaraoke = sawKaraoke || parsed.karaoke
    captions.push({
      start: round3s(d.start),
      end: round3s(d.end),
      text: parsed.text,
      words: parsed.words,
    })
  }
  captions.sort((a, b) => a.start - b.start)

  /* dominant style → editor styles */
  const usage = new Map<string, number>()
  for (const d of dialogues) usage.set(d.style, (usage.get(d.style) ?? 0) + 1)
  const dominantName =
    [...usage.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Default'
  const styleRow =
    stylesByName[dominantName] ??
    stylesByName['Default'] ??
    Object.values(stylesByName)[0]

  let styles: Record<string, any> | undefined
  if (styleRow) {
    styles = assStyleRowToStyles(styleRow, legacySsa, sawKaraoke)
  }
  if (sawKaraoke) styles = { mode: 'karaoke', ...(styles ?? {}) }

  return { captions, styles }
}

function round3s(v: number) {
  return Math.round(v * 1000) / 1000
}

/** One ASS Style row → editor subtitle styles (best-effort ASS → model map). */
function assStyleRowToStyles(
  row: Record<string, string>,
  legacySsa: boolean,
  karaoke: boolean
): Record<string, any> {
  const styles: Record<string, any> = {}
  if (row.fontname) styles.fontFamily = row.fontname.replace(/^@/, '')
  const fontSize = Number(row.fontsize)
  if (fontSize > 0) styles.fontSize = Math.round(fontSize)

  const primary = parseAssColor(row.primarycolour ?? row.primarycolor ?? '')
  const secondary = parseAssColor(row.secondarycolour ?? row.secondarycolor ?? '')
  if (karaoke && primary && secondary && secondary.alpha > 0.05) {
    // ASS karaoke: syllables start Secondary and turn Primary as they are sung
    styles.color = secondary.hex
    styles.activeWord = { color: primary.hex }
  } else if (primary) {
    styles.color = primary.hex
  }

  const boldRaw = Number(row.bold ?? 0)
  if (boldRaw === -1 || boldRaw === 1) styles.isBold = true
  const italicRaw = Number(row.italic ?? 0)
  if (italicRaw === -1 || italicRaw === 1) styles.isItalic = true

  const outlineColor = parseAssColor(row.outlinecolour ?? row.outlinecolor ?? '')
  const backColor = parseAssColor(row.backcolour ?? row.backcolor ?? '')
  const outlineW = Number(row.outline ?? 0)
  if (Number(row.borderstyle ?? 1) === 3) {
    // opaque box — the package maps `background` to BorderStyle 3 + BackColour
    const box = backColor && backColor.alpha > 0.05 ? backColor : outlineColor
    if (box) styles.background = box.hex
  } else if (outlineW > 0 && outlineColor && outlineColor.alpha > 0.05) {
    styles.outline = { width: Math.round(outlineW), color: outlineColor.hex }
  }

  let align = Number(row.alignment ?? 2)
  if (legacySsa && align) align = ssaLegacyToNumpad(align)
  const position = assAlignmentToPosition(align)
  if (position) styles.position = position

  const marginV = Number(row.marginv ?? 0)
  if (marginV > 0) styles.marginV = marginV
  const marginH = Math.max(Number(row.marginl ?? 0), Number(row.marginr ?? 0))
  if (marginH > 0) styles.marginH = marginH

  return styles
}

/** Dialogue text → plain text + karaoke words (from `\k`-family tags). */
function parseAssDialogueText(
  raw: string,
  start: number,
  end: number
): { text: string; words: RawWord[]; karaoke: boolean } {
  interface Seg {
    durCs: number | null
    text: string
  }
  const segs: Seg[] = []
  let pendingDur: number | null = null

  for (const m of raw.matchAll(/\{([^}]*)\}|([^{]+)/g)) {
    if (m[1] !== undefined) {
      // override block — accumulate karaoke durations, ignore the rest
      for (const k of m[1].matchAll(/\\[kK][fo]?\s*([\d.]+)/g)) {
        pendingDur = (pendingDur ?? 0) + parseFloat(k[1])
      }
    } else {
      const t = m[2].replace(/\\[Nn]/g, ' ').replace(/\\h/g, ' ')
      segs.push({ durCs: pendingDur, text: t })
      pendingDur = null
    }
  }

  const text = segs
    .map((s) => s.text)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  const karaoke = segs.some((s) => s.durCs !== null)
  if (!text) return { text: '', words: [], karaoke }
  if (!karaoke) return { text, words: distributeWords(text, start, end), karaoke }

  /* karaoke: per-syllable times → per-word times via the char timeline */
  const chars: { ch: string; start: number; end: number }[] = []
  let t = start
  for (const s of segs) {
    const dur = (s.durCs ?? 0) / 100
    const s0 = t
    const s1 = Math.min(t + dur, end)
    for (const ch of s.text) chars.push({ ch, start: s0, end: s1 })
    t = s1
  }
  const words: RawWord[] = []
  let cur: RawWord | null = null
  for (const c of chars) {
    if (/\s/.test(c.ch)) {
      if (cur) {
        words.push(cur)
        cur = null
      }
    } else {
      if (!cur) cur = { text: '', start: round3s(c.start), end: round3s(c.end) }
      cur.text += c.ch
      cur.end = round3s(Math.max(cur.end, c.end))
    }
  }
  if (cur) words.push(cur)
  return { text, words: words.length ? words : distributeWords(text, start, end), karaoke }
}

/* ---------------- SRT / VTT styling hints → ASS-model styles ---------------- */

const VTT_CLASS_COLORS: Record<string, string> = {
  white: '#ffffff',
  yellow: '#ffff00',
  red: '#ff0000',
  green: '#00ff00',
  blue: '#0000ff',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  lime: '#00ff00',
  black: '#000000',
}

/**
 * parseSrtVtt + best-effort conversion of SRT/VTT formatting into the
 * ASS-oriented styles model: whole-file <b>/<i>, font/class colors,
 * `{\anN}` overrides and VTT cue settings (line/align).
 */
export function parseSrtVttStyled(content: string): {
  captions: RawCaption[]
  styles?: Record<string, any>
} {
  const captions: RawCaption[] = []
  const blocks = content
    .replace(/^﻿/, '')
    .replace(/^WEBVTT.*?\n\n/s, '')
    .replace(/\r/g, '')
    .split(/\n\n+/)

  let total = 0
  let boldCount = 0
  let italicCount = 0
  let color: string | undefined
  const anCounts = new Map<number, number>()
  let vttTop = 0
  let vttAlignLeft = 0
  let vttAlignRight = 0

  for (const block of blocks) {
    const lines = block.trim().split('\n')
    if (!lines.length) continue
    const timeLineIdx = lines.findIndex((l) => l.includes('-->'))
    if (timeLineIdx === -1) continue
    const timeLine = lines[timeLineIdx]
    const [startStr, endRaw] = timeLine.split('-->')
    const endParts = (endRaw ?? '').trim().split(/\s+/)
    const start = parseTimestamp(startStr)
    const end = parseTimestamp(endParts[0] ?? '')

    /* VTT cue settings after the end timestamp */
    for (const setting of endParts.slice(1)) {
      const [k, v] = setting.split(':')
      if (k === 'line' && v !== undefined) {
        const pct = parseFloat(v)
        if (!Number.isNaN(pct) && pct <= 40) vttTop++
      } else if (k === 'align') {
        if (v === 'start' || v === 'left') vttAlignLeft++
        else if (v === 'end' || v === 'right') vttAlignRight++
      }
    }

    let rawText = lines.slice(timeLineIdx + 1).join(' ')

    /* {\anN} placement override (common SubStation-style hint in SRT) */
    const an = rawText.match(/\{\\an([1-9])\}/)
    if (an) anCounts.set(Number(an[1]), (anCounts.get(Number(an[1])) ?? 0) + 1)
    rawText = rawText.replace(/\{\\[^}]*\}/g, '')

    total++
    const stripped = rawText.trim()
    if (/^<b>[\s\S]*<\/b>$/i.test(stripped)) boldCount++
    if (/^<i>[\s\S]*<\/i>$/i.test(stripped) || /^<b>\s*<i>/i.test(stripped)) italicCount++
    if (!color) {
      const font = stripped.match(/<font[^>]*color=["']?(#[0-9a-f]{3,8}|[a-z]+)["']?/i)
      if (font) {
        const c = font[1].toLowerCase()
        color = c.startsWith('#') ? c : VTT_CLASS_COLORS[c]
      } else {
        const cls = stripped.match(/<c\.([a-z]+)[^>]*>/i)
        if (cls) color = VTT_CLASS_COLORS[cls[1].toLowerCase()]
      }
    }

    const text = rawText
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!text || end <= start) continue
    captions.push({ start, end, text, words: distributeWords(text, start, end) })
  }

  /* styles only when the hints are consistent across the file */
  const styles: Record<string, any> = {}
  if (total > 0) {
    if (boldCount / total >= 0.6) styles.isBold = true
    if (italicCount / total >= 0.6) styles.isItalic = true
    if (color && color !== '#ffffff') styles.color = color

    const domAn = [...anCounts.entries()].sort((a, b) => b[1] - a[1])[0]
    if (domAn && domAn[1] / total >= 0.6) {
      const pos = assAlignmentToPosition(domAn[0])
      if (pos) styles.position = pos
    } else if (vttTop / total >= 0.6) {
      styles.position =
        vttAlignLeft / total >= 0.6
          ? 'top-left'
          : vttAlignRight / total >= 0.6
            ? 'top-right'
            : 'top-center'
    } else if (vttAlignLeft / total >= 0.6) {
      styles.position = 'bottom-left'
    } else if (vttAlignRight / total >= 0.6) {
      styles.position = 'bottom-right'
    }
  }

  return { captions, styles: Object.keys(styles).length ? styles : undefined }
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

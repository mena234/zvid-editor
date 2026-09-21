import { describe, it, expect } from 'vitest'
import { importSubtitle, exportSubtitle, distributeWords } from '../shared/schema/subtitle'
import { graphemes, joinCaptionWords } from '../shared/ass/vendor/utils/subtitles'
import { renderCaptionWords, parseWhisperJson } from '../utils/subtitleRuntime'
import { createSubtitleMeasurer } from '../shared/ass/vendor/utils/subtitleFontMetrics'

describe('Unicode subtitle authoring', () => {
  it('segments and chunks no-space scripts without changing caption content', () => {
    for (const text of ['字幕内容保持正确。', '日本語の字幕を確認します。', 'ภาษาไทยไม่มีเว้นวรรคระหว่างคำ']) {
      const words = distributeWords(text, 0, 3)
      expect(words.length).toBeGreaterThan(1)
      expect(joinCaptionWords({ text, words })).toBe(text)
      const subtitle = importSubtitle({ captions: [{ text, start: 0, end: 3 }], maxWordsPerLine: 2 })!
      const exported = exportSubtitle(subtitle)
      expect(exported.captions.map((c: any) => c.text).join('')).toBe(text)
      expect(exported.captions.every((c: any) => c.words.length <= 2)).toBe(true)
      expect(exported.captions.at(-1).end).toBe(3)
    }
  })

  it('keeps combining clusters together during fallback typewriter playback', () => {
    const word = 'क्षि👩🏽‍💻'
    const caption = { text: word, start: 0, end: 2, words: [{ text: word, start: 0, end: 2 }] }
    const partial = renderCaptionWords(caption, 0.25, 'typewriter')[0]
    expect(partial.revealedChars).toBe(1)
    expect(graphemes(word).slice(0, partial.revealedChars).join('')).toBe('क्षि')
  })

  it('does not insert spaces in a word-only Chinese transcript import', () => {
    const captions = parseWhisperJson({ segments: [{ words: [
      { text: '你好', start: 0, end: 1 }, { text: '世界', start: 1, end: 2 },
    ] }] })
    expect(captions[0].text).toBe('你好世界')
  })

  it('measures shaped fallback runs with each face at its own libass scale', () => {
    const runs: string[] = []
    const measure = createSubtitleMeasurer([
      { family: 'Arabic', data: new Uint8Array([1]), measure: text => { runs.push(text); return text.length * 2 } },
      { family: 'CJK', data: new Uint8Array([2]), measure: text => { runs.push(text); return text.length * 3 } },
    ], 'Arabic', (font, text) => font[0] === 1 ? !/\p{Script=Han}/u.test(text) : /\p{Script=Han}/u.test(text))
    expect(measure('مرحبا世界')).toBe(16)
    expect(runs).toEqual(['مرحبا', '世界'])
  })

  it('retains the prior face for neutral text and contextual range measurements', () => {
    const measure = createSubtitleMeasurer([
      { family: 'Latin', data: new Uint8Array([0]), measure: text => text.length * 1 },
      { family: 'Arabic', data: new Uint8Array([1]), measure: text => text.length * 2 },
      { family: 'CJK', data: new Uint8Array([2]), measure: text => text.length * 3 },
    ], 'Latin', (font, text) => !/[\p{Script=Arabic}\p{Script=Han}]/u.test(text)
      || (font[0] === 1 ? /\p{Script=Arabic}/u.test(text) : font[0] === 2 && /\p{Script=Han}/u.test(text)))
    expect(measure('مرحبا 123 世界')).toBe(26)
    expect(measure.range!('مرحبا 123 世界', 5, 10)).toBe(10)
  })
})

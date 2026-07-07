import { describe, it, expect } from 'vitest'
import {
  importSubtitle,
  exportSubtitle,
  chunkCaptions,
  distributeWords,
  applyOpacityToHex,
} from '../shared/schema/subtitle'
import { importProject, exportProject } from '../shared/schema/normalize'

describe('subtitle v2 import', () => {
  it('maps flat v2 style keys onto internal styles', () => {
    const sub = importSubtitle({
      captions: [{ start: 0, end: 1, text: 'hi there' }],
      animation: 'slide',
      direction: 'left',
      font: {
        family: 'Inter',
        size: 64,
        color: '#111111',
        bold: true,
        italic: true,
        transform: 'uppercase',
      },
      stroke: { color: '#222222', width: 3 },
      background: { color: '#000000', opacity: 0.5, padding: 8 },
      activeWord: { color: '#FFD700' },
      position: 'top-right',
      margin: { x: 12, y: 34 },
    })!
    expect(sub.styles).toEqual({
      mode: 'slide',
      slideDirection: 'left',
      fontFamily: 'Inter',
      fontSize: 64,
      color: '#111111',
      isBold: true,
      isItalic: true,
      textTransform: 'uppercase',
      outline: { width: 3, color: '#222222' },
      background: '#00000080',
      backgroundPadding: 8,
      activeWord: { color: '#FFD700' },
      position: 'top-right',
      marginH: 12,
      marginV: 34,
    })
  })

  it('expands position shorthands and distributes missing words', () => {
    const sub = importSubtitle({
      captions: [{ start: 0, end: 2, text: 'hello big world' }],
      position: 'bottom',
    })!
    expect((sub.styles as any).position).toBe('bottom-center')
    expect(sub.captions[0].words).toHaveLength(3)
    expect(sub.captions[0].words[2].end).toBe(2)
  })

  it('keeps the legacy shape untouched', () => {
    const styles = { color: '#ff0000', mode: 'karaoke' }
    const sub = importSubtitle({
      captions: [
        { start: 0, end: 1, text: 'x', words: [{ start: 0, end: 1, text: 'x' }] },
      ],
      styles,
    })!
    expect(sub.styles).toEqual(styles)
  })

  it('applies maxWordsPerLine on import so preview matches render', () => {
    const sub = importSubtitle({
      captions: [{ start: 0, end: 7, text: 'one two three four five six seven' }],
      maxWordsPerLine: 3,
    })!
    expect(sub.captions.map((c) => c.text)).toEqual([
      'one two three',
      'four five six',
      'seven',
    ])
    expect(sub.captions[0].end).toBe(sub.captions[1].start)
    expect(sub.captions[2].end).toBe(7)
  })

  it('keeps src for render-time resolution', () => {
    const sub = importSubtitle({ src: 'https://cdn.example.com/c.srt' })!
    expect((sub as any).src).toBe('https://cdn.example.com/c.srt')
    expect(sub.captions).toEqual([])
  })
})

describe('subtitle v2 export', () => {
  it('serializes internal styles to the flat v2 shape', () => {
    const out = exportSubtitle({
      captions: [
        {
          start: 0,
          end: 1,
          text: 'hi',
          words: [{ start: 0, end: 1, text: 'hi' }],
        },
      ],
      styles: {
        mode: 'karaoke',
        color: '#ffffff',
        fontSize: 48,
        isBold: true,
        outline: { width: 2, color: '#000000' },
        background: '#00000080',
        backgroundPadding: 6,
        activeWord: { color: '#FFD700' },
        position: 'top-center',
        marginH: 10,
        marginV: 20,
      },
    } as any)
    expect(out).toEqual({
      captions: [
        { start: 0, end: 1, text: 'hi', words: [{ start: 0, end: 1, text: 'hi' }] },
      ],
      animation: 'karaoke',
      font: { size: 48, color: '#ffffff', bold: true },
      stroke: { color: '#000000', width: 2 },
      background: { color: '#00000080', padding: 6 },
      activeWord: { color: '#FFD700' },
      position: 'top',
      margin: { x: 10, y: 20 },
    })
  })

  it('emits src instead of captions when present', () => {
    const out = exportSubtitle({ src: 'https://cdn.example.com/c.srt', captions: [] } as any)
    expect(out).toEqual({ src: 'https://cdn.example.com/c.srt' })
  })

  it('falls back to the legacy shape when unknown style keys exist', () => {
    const out = exportSubtitle({
      captions: [{ start: 0, end: 1, text: 'x', words: [] }],
      styles: { color: '#fff', someCustomThing: true },
    } as any)
    expect(out.styles).toEqual({ color: '#fff', someCustomThing: true })
    expect(out.font).toBeUndefined()
  })

  it('round-trips: import(export(import(v2))) is stable', () => {
    const v2 = {
      captions: [{ start: 0, end: 2, text: 'hello big world' }],
      animation: 'pop',
      font: { size: 40, bold: true },
      activeWord: { color: '#FFD700' },
      position: 'center',
      margin: { x: 5, y: 6 },
    }
    const once = exportSubtitle(importSubtitle(v2)!)
    const twice = exportSubtitle(importSubtitle(once)!)
    expect(twice).toEqual(once)
  })
})

describe('project-level subtitle round-trip', () => {
  it('legacy project JSON exports as v2 and stays semantically equal', () => {
    const raw = {
      name: 'x',
      duration: 5,
      visuals: [{ type: 'TEXT', text: 'hi' }],
      subtitle: {
        captions: [
          {
            start: 0,
            end: 1,
            text: 'hello world',
            words: [
              { start: 0, end: 0.5, text: 'hello' },
              { start: 0.5, end: 1, text: 'world' },
            ],
          },
        ],
        styles: { mode: 'karaoke', color: '#ffffff', activeWord: { color: '#FFD700' } },
      },
    }
    const exported = exportProject(importProject(raw).doc)
    // exports the simplified shape…
    expect(exported.subtitle.animation).toBe('karaoke')
    expect(exported.subtitle.styles).toBeUndefined()
    // …which imports back to the same internal model
    const again = importProject(exported).doc
    expect(again.subtitle).toEqual(importProject(raw).doc.subtitle)
  })
})

describe('helpers', () => {
  it('chunkCaptions keeps short captions as-is', () => {
    const caps = [
      { start: 0, end: 1, text: 'a b', words: distributeWords('a b', 0, 1) },
    ]
    expect(chunkCaptions(caps as any, 4)).toHaveLength(1)
  })

  it('applyOpacityToHex folds and multiplies alpha', () => {
    expect(applyOpacityToHex('#000000', 0.5)).toBe('#00000080')
    expect(applyOpacityToHex('#00000080', 0.5)).toBe('#00000040')
    expect(applyOpacityToHex('#123456', undefined)).toBe('#123456')
  })
})

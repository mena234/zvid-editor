import { describe, expect, it, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { fontVariantCandidates, parseFontFamilies, resolveFontFamilies } from '../../shared/fontResolution'

describe('shared multilingual font contract', () => {
  it('stays identical to the renderer resolver', () => {
    const editor = readFileSync(fileURLToPath(new URL('../../shared/fontResolution.ts', import.meta.url)), 'utf8')
    const renderer = readFileSync(fileURLToPath(new URL('../../../package/src/utils/fontResolution.ts', import.meta.url)), 'utf8')
    expect(editor).toBe(renderer)
  })
  it('resolves quoted stacks and fonts for the actual script', () => {
    expect(parseFontFamilies('"Poppins", "Noto Sans Arabic", sans-serif')).toEqual(['Poppins', 'Noto Sans Arabic'])
    expect(resolveFontFamilies('Poppins', 'שלום עולם')).toEqual(['Poppins', 'Noto Sans Hebrew', 'Noto Sans'])
    expect(fontVariantCandidates({ weight: 700, italic: true })).toEqual([
      { weight: 700, italic: true }, { weight: 700, italic: false }, { weight: 400, italic: false },
    ])
  })
})

describe('font proxy', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })
  it('serves upright bold when a script font has no italic face', async () => {
    const bytes = new Uint8Array([0, 1, 2, 3]).buffer
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('@1,700')) throw new Error('400 unknown variant')
      if (url.includes('fonts.googleapis.com')) return 'src: url(https://fonts.gstatic.com/bold.ttf)'
      return bytes
    })
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('getQuery', () => ({ family: 'Noto Sans Devanagari', weight: '700', italic: '1' }))
    vi.stubGlobal('setHeader', vi.fn())
    vi.stubGlobal('createError', (error: unknown) => error)
    vi.stubGlobal('$fetch', fetcher)
    const { default: handler } = await import('../../server/api/fonts.get')
    const result = await handler({} as any)
    expect(result).toEqual(new Uint8Array(bytes))
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:ital,wght@1,700&display=swap',
      'https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:ital,wght@0,700&display=swap',
      'https://fonts.gstatic.com/bold.ttf',
    ])
  })
})

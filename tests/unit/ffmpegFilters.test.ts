import { describe, it, expect, beforeAll } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { runInNewContext } from 'node:vm'
import { reentrantFfmpegCore } from '../../utils/ffmpegCoreSource'
import {
  hasMediaFilter,
  mediaFilterArgs,
  mediaFilterGraph,
  type MediaFilter,
} from '../../utils/ffmpegFilterGraph'

const require = createRequire(import.meta.url)
const { getStyleFilters, toGraph } = require('../helpers/nativeStyle.cjs')
let core: any
beforeAll(async () => {
  // The exact browser build, supplied its bytes instead of a browser fetch.
  const context = {
    module: { exports: {} },
    self: { location: { href: 'file:///ffmpeg-core.js' } },
    console,
    performance,
    TextDecoder,
    TextEncoder,
    setTimeout,
    clearTimeout,
  }
  const createCore = runInNewContext(
    reentrantFfmpegCore(readFileSync(require.resolve('@ffmpeg/core'), 'utf8')) +
      '\ncreateFFmpegCore;',
    context
  )
  core = await createCore({
    wasmBinary: readFileSync(require.resolve('@ffmpeg/core/wasm')),
  })
}, 30_000)

export const cases: MediaFilter[] = [
  {},
  {
    brightness: 0,
    contrast: 0,
    saturate: 0,
    blur: 0,
    invert: false,
    'hue-rotate': '0deg',
  },
  ...[-100, -50, -1, 1, 20, 100].map((brightness) => ({ brightness })),
  ...[-100, -50, -1, 0.1, 1, 2, 5, 10, 25, 50, 75, 100].map((contrast) => ({ contrast })),
  ...[-100, -50, -1, 1, 50, 100].map((saturate) => ({ saturate })),
  ...['-180deg', '-90deg', '1deg', '45.25deg', '90deg', '180deg', '360deg'].map(
    (hue) => ({ 'hue-rotate': hue })
  ),
  ...[0.1, 1, 20, 50, 99, 100, '100.0'].map((blur) => ({ blur })),
  ...[true, 0.05, 0.25, 0.5, 0.95, 1].map((invert) => ({ invert })),
  ...['#f60', '#ff6600', '#ffffff', '#000000', '#12abef'].map((colorTint) => ({
    colorTint,
  })),
  {
    brightness: 20,
    contrast: -25,
    saturate: 50,
    'hue-rotate': '45deg',
    blur: 20,
    invert: 0.25,
    colorTint: '#abcd12',
  },
  {
    brightness: -20,
    contrast: 1,
    saturate: 100,
    'hue-rotate': '-90deg',
    blur: 100,
    invert: true,
    colorTint: '#f60',
  },
  { brightness: 100, contrast: -100, saturate: -100, blur: 100, invert: 0.5 },
  { brightness: 20, saturate: 50, invert: 0.99 },
  { brightness: 20, saturate: 50, invert: 1 },
  { contrast: '0', saturate: '0', blur: 20 },
]

function fixture(width: number, height: number) {
  const pixels = Buffer.alloc(width * height * 4)
  let seed = 23
  for (let i = 0; i < pixels.length; i += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0
    const x = (i / 4) % width,
      y = Math.floor(i / 4 / width)
    pixels[i] = (x / Math.max(1, width - 1)) * 255
    pixels[i + 1] = (y / Math.max(1, height - 1)) * 255
    pixels[i + 2] = seed >>> 24
    pixels[i + 3] = x % 5 === 0 ? 0 : x % 5 === 1 ? 128 : 255
  }
  return pixels
}

describe('FFmpeg filter parity (actual native and WebAssembly engines)', () => {
  it('rejects an unrecognized core upgrade', () => {
    expect(() => reentrantFfmpegCore('changed upstream')).toThrow('Unsupported')
  })
  it('neutral values bypass filtering', () => {
    expect(hasMediaFilter()).toBe(false)
    expect(hasMediaFilter(cases[1])).toBe(false)
  })
  for (const [width, height] of [
    [64, 48],
    [65, 49],
    [2, 2],
    [1, 9],
  ]) {
    it(`matches the package graph and native pixels at ${width}×${height}`, () => {
      const data = fixture(width!, height!)
      for (const filter of cases) {
        const spec = getStyleFilters(filter, '0:v', 0, {
          width,
          height,
        } as any)
        const graph = mediaFilterGraph(filter, width!, height!)
        expect(graph.graph, JSON.stringify(filter)).toBe(toGraph(spec.filters))
        expect(graph.output).toBe(spec.output)
        const args = mediaFilterArgs(filter, width!, height!)
        const nativeArgs = args.map((a) =>
          a === 'input.rgba' ? 'pipe:0' : a === 'output.rgba' ? 'pipe:1' : a
        )
        const native = spawnSync('ffmpeg', nativeArgs, {
          input: data,
          timeout: 10_000,
          windowsHide: true,
        })
        expect(native.status, native.stderr?.toString()).toBe(0)
        let log = ''
        core.setLogger(({ message }: any) => {
          log += message + '\n'
        })
        core.FS.writeFile('input.rgba', data)
        try {
          core.exec(...args)
        } catch (error) {
          throw new Error(`${width}x${height} ${JSON.stringify(filter)}: ${error}`)
        }
        const status = core.ret
        core.reset()
        expect(status, log).toBe(0)
        const actual = core.FS.readFile('output.rgba')
        core.FS.unlink('input.rgba')
        core.FS.unlink('output.rgba')
        expect(actual.length).toBe(data.length)
        expect(native.stdout.length).toBe(data.length)
        let max = 0,
          total = 0
        for (let i = 0; i < actual.length; i++) {
          const diff = Math.abs(actual[i] - native.stdout[i]!)
          max = Math.max(max, diff)
          total += diff
          if (i % 4 === 3) expect(actual[i], `alpha at ${i}`).toBe(data[i])
        }
        expect({ max, total }, JSON.stringify(filter)).toEqual({
          max: 0,
          total: 0,
        })
      }
    }, 60_000)
  }
  it('processes 600 more frames without leaking the command stack', () => {
    const input = fixture(64, 48)
    const args = mediaFilterArgs({ brightness: 20, blur: 100 }, 64, 48)
    const memory = core.HEAPU8.length
    for (let frame = 0; frame < 600; frame++) {
      core.FS.writeFile('input.rgba', input)
      core.exec(...args)
      const status = core.ret
      core.reset()
      expect(status, `frame ${frame}`).toBe(0)
      expect(core.FS.readFile('output.rgba').length).toBe(input.length)
      core.FS.unlink('input.rgba')
      core.FS.unlink('output.rgba')
    }
    expect(core.HEAPU8.length).toBe(memory)
  }, 30_000)
})

/**
 * utils/stockDrag.ts — stock panel ↔ stage drag-and-drop contract and the
 * dropped-item placement math. DataTransfer is stubbed with a minimal
 * object (no jsdom).
 */
import { describe, it, expect } from 'vitest'
import {
  STOCK_DRAG_MIME,
  setStockDragData,
  parseStockDragData,
  isStockDrag,
  buildStockVisual,
  type StockDragPayload,
} from '../../utils/stockDrag'

class FakeDataTransfer {
  private data = new Map<string, string>()
  effectAllowed = 'uninitialized'
  get types(): string[] {
    return [...this.data.keys()]
  }
  setData(type: string, value: string) {
    this.data.set(type, value)
  }
  getData(type: string): string {
    return this.data.get(type) ?? ''
  }
}

const dragEvent = (dt: FakeDataTransfer | null) =>
  ({ dataTransfer: dt }) as unknown as DragEvent

describe('drag payload round-trip', () => {
  it('serializes under the stock MIME and parses back identically', () => {
    const payload: StockDragPayload = {
      kind: 'VIDEO',
      src: 'https://cdn.example/clip.mp4',
      width: 1280,
      height: 720,
      duration: 12.5,
    }
    const dt = new FakeDataTransfer()
    const e = dragEvent(dt)
    setStockDragData(e, payload)
    expect(parseStockDragData(e)).toEqual(payload)
  })
  it('sets a text/plain fallback and copy effect', () => {
    const dt = new FakeDataTransfer()
    setStockDragData(dragEvent(dt), { kind: 'IMAGE', src: 'https://x/i.jpg' })
    expect(dt.getData('text/plain')).toBe('https://x/i.jpg')
    expect(dt.effectAllowed).toBe('copy')
  })
  it('is a no-op without a dataTransfer', () => {
    expect(() => setStockDragData(dragEvent(null), { kind: 'GIF', src: 's' })).not.toThrow()
  })
})

describe('isStockDrag', () => {
  it('detects the stock MIME among the drag types', () => {
    const dt = new FakeDataTransfer()
    dt.setData(STOCK_DRAG_MIME, '{}')
    expect(isStockDrag(dragEvent(dt))).toBe(true)
  })
  it('rejects foreign drags and missing dataTransfer', () => {
    const dt = new FakeDataTransfer()
    dt.setData('text/plain', 'hello')
    expect(isStockDrag(dragEvent(dt))).toBe(false)
    expect(isStockDrag(dragEvent(null))).toBe(false)
  })
})

describe('parseStockDragData rejects malformed payloads', () => {
  const withRaw = (raw: string) => {
    const dt = new FakeDataTransfer()
    dt.setData(STOCK_DRAG_MIME, raw)
    return dragEvent(dt)
  }
  it('returns null for missing data, bad JSON, missing/empty src', () => {
    expect(parseStockDragData(dragEvent(new FakeDataTransfer()))).toBeNull()
    expect(parseStockDragData(dragEvent(null))).toBeNull()
    expect(parseStockDragData(withRaw('{oops'))).toBeNull()
    expect(parseStockDragData(withRaw('{"kind":"IMAGE"}'))).toBeNull()
    expect(parseStockDragData(withRaw('{"kind":"IMAGE","src":""}'))).toBeNull()
    expect(parseStockDragData(withRaw('null'))).toBeNull()
  })
})

describe('buildStockVisual — timing', () => {
  const base = {
    playhead: 2,
    contextDuration: 30,
    projectWidth: 1920,
    projectHeight: 1080,
  }
  it('images run 5s from the playhead', () => {
    const item = buildStockVisual({ kind: 'IMAGE', src: 's' }, base)
    expect(item.type).toBe('IMAGE')
    expect(item.enterBegin).toBe(2)
    expect(item.exitEnd).toBe(7)
  })
  it('videos use their own duration', () => {
    const item = buildStockVisual(
      { kind: 'VIDEO', src: 's', duration: 12 },
      base
    )
    expect(item.exitEnd).toBe(14)
  })
  it('video spans are at least 1s; missing duration falls back to 5s', () => {
    expect(
      buildStockVisual({ kind: 'VIDEO', src: 's', duration: 0.4 }, base).exitEnd
    ).toBe(3)
    expect(buildStockVisual({ kind: 'VIDEO', src: 's' }, base).exitEnd).toBe(7)
  })
  it('clip start is capped at contextDuration−1 and the end at contextDuration', () => {
    const item = buildStockVisual(
      { kind: 'IMAGE', src: 's' },
      { ...base, playhead: 100, contextDuration: 10 }
    )
    expect(item.enterBegin).toBe(9)
    expect(item.exitEnd).toBe(10)
  })
  it('playhead 0 leaves enterBegin undefined (default start)', () => {
    const item = buildStockVisual({ kind: 'IMAGE', src: 's' }, { ...base, playhead: 0 })
    expect(item.enterBegin).toBeUndefined()
  })
})

describe('buildStockVisual — placement without a drop point (click-to-add)', () => {
  const opts = {
    playhead: 0,
    contextDuration: 20,
    projectWidth: 1080,
    projectHeight: 1920,
  }
  it('images/videos fill the frame centered with contain', () => {
    const img = buildStockVisual(
      { kind: 'IMAGE', src: 's', width: 4000, height: 3000 },
      opts
    )
    expect(img.position).toBe('center-center')
    expect(img.anchor).toBe('center-center')
    expect(img.resize).toBe('contain')
    // no explicit box in the centered path
    expect(img.width).toBeUndefined()
    expect(img.height).toBeUndefined()
    expect(img.x).toBeUndefined()
  })
  it('GIFs keep their intrinsic size (no resize)', () => {
    const gif = buildStockVisual({ kind: 'GIF', src: 's' }, opts)
    expect(gif.resize).toBeUndefined()
    expect(gif.position).toBe('center-center')
  })
})

describe('buildStockVisual — drop-point placement and scale math', () => {
  const at = { x: 500.4, y: 300.6 }
  it('centers on the (rounded) drop point, scaled to at most half the frame', () => {
    const item = buildStockVisual(
      { kind: 'IMAGE', src: 's', width: 800, height: 600 },
      {
        playhead: 1,
        contextDuration: 30,
        projectWidth: 1920,
        projectHeight: 1080,
        at,
      }
    )
    // scale = min(1, 960/800, 540/600) = 0.9
    expect(item.width).toBe(720)
    expect(item.height).toBe(540)
    expect(item.anchor).toBe('center-center')
    expect(item.x).toBe(500)
    expect(item.y).toBe(301)
    expect(item.position).toBeUndefined()
    expect(item.resize).toBeUndefined()
  })
  it('never upscales small media (scale caps at 1)', () => {
    const item = buildStockVisual(
      { kind: 'GIF', src: 's', width: 100, height: 80 },
      { playhead: 0, contextDuration: 10, projectWidth: 1920, projectHeight: 1080, at }
    )
    expect(item.width).toBe(100)
    expect(item.height).toBe(80)
  })
  it('the tighter axis wins on a different project aspect', () => {
    const item = buildStockVisual(
      { kind: 'VIDEO', src: 's', width: 4000, height: 1000, duration: 3 },
      { playhead: 0, contextDuration: 10, projectWidth: 1080, projectHeight: 1920, at }
    )
    // scale = min(1, 540/4000=0.135, 960/1000=0.96) = 0.135
    expect(item.width).toBe(540)
    expect(item.height).toBe(135)
  })
  it('drops without intrinsic dims skip the explicit box', () => {
    const item = buildStockVisual(
      { kind: 'IMAGE', src: 's' },
      { playhead: 0, contextDuration: 10, projectWidth: 1920, projectHeight: 1080, at }
    )
    expect(item.width).toBeUndefined()
    expect(item.height).toBeUndefined()
    expect(item.x).toBe(500)
    expect(item.anchor).toBe('center-center')
  })
})

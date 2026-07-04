import { round3 } from '~/utils/time'

/**
 * Drag-and-drop contract between the stock media sidebar and the stage:
 * the panel serializes a StockDragPayload under STOCK_DRAG_MIME, the stage
 * parses it back and turns it into a zvid visual item.
 */
export const STOCK_DRAG_MIME = 'application/x-zvid-stock'

export interface StockDragPayload {
  kind: 'IMAGE' | 'VIDEO' | 'GIF'
  src: string
  /** intrinsic dimensions of `src`, when the provider reports them */
  width?: number
  height?: number
  /** seconds — videos only */
  duration?: number
}

export function setStockDragData(e: DragEvent, payload: StockDragPayload) {
  if (!e.dataTransfer) return
  e.dataTransfer.setData(STOCK_DRAG_MIME, JSON.stringify(payload))
  // plain-text fallback keeps the drag alive for targets that ignore our type
  e.dataTransfer.setData('text/plain', payload.src)
  e.dataTransfer.effectAllowed = 'copy'
}

export function isStockDrag(e: DragEvent): boolean {
  return !!e.dataTransfer && Array.from(e.dataTransfer.types).includes(STOCK_DRAG_MIME)
}

export function parseStockDragData(e: DragEvent): StockDragPayload | null {
  const raw = e.dataTransfer?.getData(STOCK_DRAG_MIME)
  if (!raw) return null
  try {
    const p = JSON.parse(raw)
    return p && typeof p.src === 'string' && p.src ? (p as StockDragPayload) : null
  } catch {
    return null
  }
}

export interface StockPlacement {
  playhead: number
  contextDuration: number
  projectWidth: number
  projectHeight: number
  /** stage drop point in project coordinates; omitted = add centered */
  at?: { x: number; y: number } | null
}

/**
 * Build a zvid visual item from a stock payload. Timing matches the Add
 * panel: clip starts at the playhead and runs 5s (or the video's own length),
 * capped at the context duration. Dropped items land centered on the drop
 * point at up to half the frame size; clicked items fill the frame (contain).
 */
export function buildStockVisual(
  payload: StockDragPayload,
  opts: StockPlacement
): Record<string, any> {
  const t0 = round3(Math.min(opts.playhead, Math.max(0, opts.contextDuration - 1)))
  const span =
    payload.kind === 'VIDEO' && payload.duration ? Math.max(1, payload.duration) : 5
  const item: Record<string, any> = {
    type: payload.kind,
    src: payload.src,
    enterBegin: t0 || undefined,
    exitEnd: round3(Math.min(opts.contextDuration, t0 + span)),
  }
  if (opts.at) {
    item.anchor = 'center-center'
    if (payload.width && payload.height) {
      const scale = Math.min(
        1,
        (opts.projectWidth * 0.5) / payload.width,
        (opts.projectHeight * 0.5) / payload.height
      )
      item.width = Math.max(1, Math.round(payload.width * scale))
      item.height = Math.max(1, Math.round(payload.height * scale))
    }
    item.x = Math.round(opts.at.x)
    item.y = Math.round(opts.at.y)
  } else {
    item.position = 'center-center'
    item.anchor = 'center-center'
    if (payload.kind !== 'GIF') item.resize = 'contain'
  }
  return item
}

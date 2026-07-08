/**
 * Video↔video linked transitions (package generateTransitionsFilters):
 * item A carries `transition` + `transitionId` pointing at item B's public
 * `id`; both streams are re-based onto full-frame canvases and xfaded with
 * offset = B.enterBegin and duration = A.transitionDuration.
 *
 * This computes the active xfade layer styles for the stage preview.
 */
import type { VisualDoc } from '~/shared/schema/types'
import { effectiveLayout, resolveVisualTiming } from '~/utils/itemGeometry'
import {
  xfadeFrame,
  type XfadeLayerCss,
  type XfadePlateCss,
} from '~/utils/xfade'

export interface GroupFxResult {
  styleById: Map<string, XfadeLayerCss>
  plates: XfadePlateCss[]
}

export function activeGroupFx(
  items: VisualDoc[],
  time: number,
  contextDuration: number,
  projW: number,
  projH: number,
  rasterScale = 1
): GroupFxResult | null {
  let styleById: Map<string, XfadeLayerCss> | null = null
  const plates: XfadePlateCss[] = []
  for (const a of items) {
    const tid = a.transitionId
    if (!a.transition || !tid || tid === 'none') continue
    const b = items.find((v) => v._id !== a._id && v.id === tid)
    if (!b) continue
    const dur = a.transitionDuration ?? 0.5
    if (dur <= 0) continue
    const start = resolveVisualTiming(b, contextDuration).enterBegin
    const t = (time - start) / dur
    if (t < 0 || t > 1) continue
    const LA = effectiveLayout(a, projW, projH)
    const LB = effectiveLayout(b, projW, projH)
    const frame = xfadeFrame(a.transition, t, {
      mode: 'transition',
      canvasW: projW,
      canvasH: projH,
      rectA: { x: LA.left, y: LA.top, w: LA.width, h: LA.height },
      rectB: { x: LB.left, y: LB.top, w: LB.width, h: LB.height },
      rasterScale,
    })
    if (!styleById) styleById = new Map()
    styleById.set(a._id, frame.a)
    styleById.set(b._id, frame.b)
    if (frame.plate) plates.push(frame.plate)
  }
  return styleById ? { styleById, plates } : null
}

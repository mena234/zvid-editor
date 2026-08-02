<script setup lang="ts">
import { computed, inject } from 'vue'
import type { VisualDoc } from '~/shared/schema/types'
import { canonicalVisualType } from '~/shared/schema/types'
import { effectiveLayout, isVisibleAt, resolveVisualTiming } from '~/utils/itemGeometry'
import { topLeftToAnchor } from '~/shared/schema/defaults'
import {
  xfadeFrame,
  layerStyle,
  plateStyle,
  deviceScale,
  type XfadeFrameCss,
  type XfadeLayerCss,
} from '~/utils/xfade'
import { useEditorStore } from '~/stores/editor'
import { useProjectStore } from '~/stores/project'
import { round3 } from '~/utils/time'

const props = defineProps<{
  item: VisualDoc
  time: number
  contextDuration: number
  interactive: boolean
  /** active video↔video xfade layer style (computed by StageView) */
  groupFx?: XfadeLayerCss | null
}>()

const editor = useEditorStore()
const project = useProjectStore()
const stageCtx = inject<any>('stageCtx')

const type = computed(() => canonicalVisualType(props.item.type))

const layout = computed(() =>
  effectiveLayout(props.item, stageCtx.projW, stageCtx.projH)
)

const timing = computed(() => resolveVisualTiming(props.item, props.contextDuration))

const visible = computed(
  () => props.time >= timing.value.enterBegin && props.time <= timing.value.exitEnd
)

/* enter/exit animation — exact xfade composite (item vs transparent canvas
 * the size of the item box, mirroring package getAnimationFilter) */
const OPAQUE_TYPES = new Set(['VIDEO', 'IMAGE', 'GIF'])

const animFx = computed<{ frame: XfadeFrameCss; role: 'a' | 'b' } | null>(() => {
  const t = props.time
  const tm = timing.value
  const item = props.item
  const L = layout.value
  const base = {
    canvasW: L.width,
    canvasH: L.height,
    contentOpaque: OPAQUE_TYPES.has(type.value ?? ''),
    rasterScale: deviceScale(stageCtx.scale),
  }
  if (item.enterAnimation && t >= tm.enterBegin && t < tm.enterEnd) {
    const p = (t - tm.enterBegin) / Math.max(0.001, tm.enterEnd - tm.enterBegin)
    return {
      frame: xfadeFrame(item.enterAnimation, p, { mode: 'enter', ...base }),
      role: 'b',
    }
  }
  // the renderer suppresses the exit animation when a transition is linked
  const transitionSuppressed = !!(item.transition && item.transitionId)
  if (
    item.exitAnimation &&
    !transitionSuppressed &&
    t > tm.exitBegin &&
    t <= tm.exitEnd
  ) {
    const p = (t - tm.exitBegin) / Math.max(0.001, tm.exitEnd - tm.exitBegin)
    return {
      frame: xfadeFrame(item.exitAnimation, p, { mode: 'exit', ...base }),
      role: 'a',
    }
  }
  return null
})

const animLayerStyle = computed(() => {
  const fx = animFx.value
  if (!fx) return {}
  const layer = fx.role === 'b' ? fx.frame.b : fx.frame.a
  if (layer.visibility === 'hidden') return { visibility: 'hidden' as const }
  return layerStyle(layer)
})

const animPlateStyle = computed(() =>
  animFx.value?.frame.plate ? plateStyle(animFx.value.frame.plate) : null
)

const animClips = computed(() => !!animFx.value?.frame.clip)

const groupFxStyle = computed(() => layerStyle(props.groupFx))

/* Ken Burns zoom progress (getZoomFilter: 1 → depth across visible window).
 * The renderer only zooms these types, and its perspective filter's output
 * stays exactly the item box — the media magnifies inside the frame, so the
 * preview must clip the scaled content to the box. */
const ZOOMABLE_TYPES = new Set(['VIDEO', 'IMAGE', 'GIF', 'SVG'])

const zoomActive = computed(
  () => !!props.item.zoom && ZOOMABLE_TYPES.has(type.value ?? '')
)

const zoomScale = computed(() => {
  if (!zoomActive.value) return 1
  const z = props.item.zoom
  const depth = typeof z === 'object' && z !== null ? (z.depth ?? 1.2) : 1.2
  const tm = timing.value
  const dur = Math.max(0.001, tm.exitEnd - tm.enterBegin)
  const p = Math.min(1, Math.max(0, (props.time - tm.enterBegin) / dur))
  return 1 + (Math.min(10, Math.max(1, depth)) - 1) * p
})

/* shouldClipRadiusAfterZoom parity: with zoom + radius + explicit w/h and no
 * rotation, the renderer clips the corners after the zoom — the frame shape
 * stays fixed while only the media zooms underneath. */
const clipRadiusAfterZoom = computed(() => {
  if (!zoomActive.value) return false
  const r = props.item.radius
  const hasRadius =
    !!r && ((r.tl ?? 0) > 0 || (r.tr ?? 0) > 0 || (r.br ?? 0) > 0 || (r.bl ?? 0) > 0)
  return (
    hasRadius &&
    props.item.width !== undefined &&
    props.item.height !== undefined &&
    !props.item.angle
  )
})

const wrapperStyle = computed(() => {
  const L = layout.value
  const item = props.item
  const flips: string[] = []
  if (item.flipH) flips.push('scaleX(-1)')
  if (item.flipV) flips.push('scaleY(-1)')
  const rotate = item.angle ? `rotate(${item.angle}deg)` : ''
  const r = item.radius
  return {
    left: `${L.left}px`,
    top: `${L.top}px`,
    width: `${L.width}px`,
    height: `${L.height}px`,
    transform: [rotate, ...flips].join(' ') || undefined,
    opacity: item.opacity ?? 1,
    borderRadius:
      clipRadiusAfterZoom.value && r
        ? `${r.tl ?? 0}px ${r.tr ?? 0}px ${r.br ?? 0}px ${r.bl ?? 0}px`
        : undefined,
    zIndex: undefined as any,
  }
})

/* ---------------- drag to move ---------------- */
let dragStart: {
  px: number
  py: number
  items: { id: string; left: number; top: number; w: number; h: number; anchor: any }[]
  moved: boolean
  /** top-most item under the pointer, selected on release if no drag happened */
  deferredSelect: string | null
} | null = null

/** ids of the current visual selection (empty when nothing visual is selected) */
function selectedVisualIds(): string[] {
  if (editor.selectionKind !== 'visual') return []
  if (editor.selectedIds.length) return editor.selectedIds
  return editor.selectedId ? [editor.selectedId] : []
}

/** does the pointer land inside a currently-visible selected item's box? */
function pointerOverSelection(e: PointerEvent): boolean {
  const ids = selectedVisualIds()
  if (!ids.length) return false
  const p = stageCtx.canvasPoint(e)
  return ids.some((id) => {
    const doc = project.visualById(id)
    if (!doc || !isVisibleAt(doc, props.time, props.contextDuration)) return false
    const L = effectiveLayout(doc, stageCtx.projW, stageCtx.projH)
    return (
      p.x >= L.left && p.x <= L.left + L.width && p.y >= L.top && p.y <= L.top + L.height
    )
  })
}

function onPointerDown(e: PointerEvent) {
  if (!props.interactive || e.button !== 0) return
  e.stopPropagation()

  const additive = e.shiftKey
  const alreadySelected =
    editor.selectionKind === 'visual' &&
    (editor.selectedIds.includes(props.item._id) || editor.selectedId === props.item._id)

  // An element selected elsewhere (timeline, layers) can sit UNDER this one:
  // clicking would steal the selection to the top layer and make lower layers
  // undraggable on the stage. When the pointer lands inside the selected
  // item's box, keep that selection and drag it; a plain click (no movement)
  // still falls through to selecting this item on release.
  const dragSelection = !alreadySelected && !additive && pointerOverSelection(e)

  if (!dragSelection) {
    if (!alreadySelected || additive) editor.selectVisual(props.item._id, additive)
    editor.openInspector()
    if (additive) return
  }

  const ids = dragSelection
    ? selectedVisualIds()
    : editor.selectedIds.length
      ? editor.selectedIds
      : [props.item._id]
  const items = ids
    .map((id) => {
      const doc = project.visualById(id)
      if (!doc) return null
      const L = effectiveLayout(doc, stageCtx.projW, stageCtx.projH)
      return { id, left: L.left, top: L.top, w: L.width, h: L.height, anchor: L.anchor }
    })
    .filter(Boolean) as any[]

  dragStart = {
    px: e.clientX,
    py: e.clientY,
    items,
    moved: false,
    deferredSelect: dragSelection ? props.item._id : null,
  }
  stageCtx.collectSnapLines(new Set(ids))
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragUp)
}

function onDragMove(e: PointerEvent) {
  if (!dragStart) return
  const dx = (e.clientX - dragStart.px) / stageCtx.scale
  const dy = (e.clientY - dragStart.py) / stageCtx.scale
  if (!dragStart.moved && Math.abs(dx) < 2 && Math.abs(dy) < 2) return
  dragStart.moved = true

  // snap using the primary (first) item's box
  const primary = dragStart.items[0]
  let offX = dx
  let offY = dy
  if (primary) {
    const snapped = stageCtx.snapBox(
      primary.left + dx,
      primary.top + dy,
      primary.w,
      primary.h
    )
    offX = snapped.left - primary.left
    offY = snapped.top - primary.top
  }

  for (const it of dragStart.items) {
    const { x, y } = topLeftToAnchor(it.left + offX, it.top + offY, it.w, it.h, it.anchor)
    project.patchVisual(
      it.id,
      {
        x: round3(x),
        y: round3(y),
        position:
          (project.visualById(it.id)?.position ?? 'custom') !== 'custom'
            ? 'custom'
            : undefined,
        anchor: it.anchor,
      },
      false
    )
  }
}

function onDragUp() {
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragUp)
  stageCtx.clearGuides()
  if (dragStart?.moved) project.commit()
  else if (dragStart?.deferredSelect) {
    // pointer never moved — this was a plain click, not a selection drag
    editor.selectVisual(dragStart.deferredSelect)
    editor.openInspector()
  }
  dragStart = null
}

function onContextMenu(e: MouseEvent) {
  if (!props.interactive) return
  e.preventDefault()
  e.stopPropagation()
  if (
    !(
      editor.selectionKind === 'visual' &&
      (editor.selectedId === props.item._id ||
        editor.selectedIds.includes(props.item._id))
    )
  ) {
    editor.selectVisual(props.item._id)
    editor.openInspector()
  }
  stageCtx.openContextMenu(e, props.item._id)
}

const isSelected = computed(
  () =>
    props.interactive &&
    editor.selectionKind === 'visual' &&
    (editor.selectedId === props.item._id || editor.selectedIds.includes(props.item._id))
)
</script>

<template>
  <div
    v-show="visible"
    class="stage-item"
    :class="{ selected: isSelected, interactive, clipping: animClips || zoomActive }"
    :style="wrapperStyle"
    :data-item-id="item._id"
    @pointerdown="onPointerDown"
    @contextmenu="onContextMenu"
  >
    <div class="group-fx-wrap" :style="groupFxStyle">
      <!-- fade-through-color plate of the enter/exit xfade (item-box canvas) -->
      <div v-if="animPlateStyle" class="anim-plate" :style="animPlateStyle" />
      <div class="anim-wrap" :style="animLayerStyle">
        <div
          class="zoom-wrap"
          :style="zoomScale !== 1 ? { transform: `scale(${zoomScale})` } : undefined"
        >
          <StageItemContent
            :item="item"
            :time="time"
            :context-duration="contextDuration"
            :width="layout.width"
            :height="layout.height"
            :suppress-radius="clipRadiusAfterZoom"
          />
        </div>
      </div>
    </div>
    <div v-if="item.chromaKey" class="fx-chip" title="Chroma key applied at render time">
      CK
    </div>
  </div>
</template>

<style scoped>
.stage-item {
  position: absolute;
  user-select: none;
}
.stage-item.interactive {
  cursor: move;
}
.stage-item.interactive:hover::after {
  content: '';
  position: absolute;
  inset: 0;
  outline: 1.5px solid color-mix(in srgb, var(--accent) 60%, transparent);
  pointer-events: none;
}
.group-fx-wrap,
.anim-wrap,
.zoom-wrap {
  width: 100%;
  height: 100%;
}
.group-fx-wrap {
  position: relative;
}
.zoom-wrap {
  transform-origin: center center;
}
.anim-wrap {
  overflow: visible;
  position: relative;
}
/* slides/zoom xfades and the Ken Burns zoom move/scale content inside the
   item's canvas — clip to it */
.stage-item.clipping {
  overflow: hidden;
}
.anim-plate {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.fx-chip {
  position: absolute;
  top: 4px;
  right: 4px;
  font-size: 9px;
  font-weight: 700;
  padding: 1px 4px;
  background: rgba(62, 207, 142, 0.85);
  color: #04250f;
  border-radius: 3px;
  pointer-events: none;
}
</style>

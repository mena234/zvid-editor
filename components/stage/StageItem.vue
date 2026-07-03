<script setup lang="ts">
import { computed, inject } from 'vue'
import type { VisualDoc } from '~/shared/schema/types'
import { canonicalVisualType } from '~/shared/schema/types'
import { effectiveLayout, resolveVisualTiming } from '~/utils/itemGeometry'
import { topLeftToAnchor } from '~/shared/schema/defaults'
import { xfadeToCss, type AnimStyle } from '~/utils/xfadeCss'
import { useEditorStore } from '~/stores/editor'
import { useProjectStore } from '~/stores/project'
import { round3 } from '~/utils/time'

const props = defineProps<{
  item: VisualDoc
  time: number
  contextDuration: number
  interactive: boolean
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

/* enter/exit xfade animation approximation */
const animStyle = computed<AnimStyle>(() => {
  const t = props.time
  const tm = timing.value
  const item = props.item
  if (item.enterAnimation && t >= tm.enterBegin && t < tm.enterEnd) {
    const p = (t - tm.enterBegin) / Math.max(0.001, tm.enterEnd - tm.enterBegin)
    return xfadeToCss(item.enterAnimation, p)
  }
  const transitionSuppressed = !!(item.transition && item.transitionId)
  if (
    item.exitAnimation &&
    !transitionSuppressed &&
    t > tm.exitBegin &&
    t <= tm.exitEnd
  ) {
    const p = (t - tm.exitBegin) / Math.max(0.001, tm.exitEnd - tm.exitBegin)
    return xfadeToCss(item.exitAnimation, 1 - p)
  }
  return {}
})

/* Ken Burns zoom progress (getZoomFilter: 1 → depth across visible window) */
const zoomScale = computed(() => {
  const z = props.item.zoom
  if (!z) return 1
  const depth = typeof z === 'object' && z !== null ? (z.depth ?? 1.2) : 1.2
  const tm = timing.value
  const dur = Math.max(0.001, tm.exitEnd - tm.enterBegin)
  const p = Math.min(1, Math.max(0, (props.time - tm.enterBegin) / dur))
  return 1 + (Math.min(10, Math.max(1, depth)) - 1) * p
})

const wrapperStyle = computed(() => {
  const L = layout.value
  const item = props.item
  const flips: string[] = []
  if (item.flipH) flips.push('scaleX(-1)')
  if (item.flipV) flips.push('scaleY(-1)')
  const rotate = item.angle ? `rotate(${item.angle}deg)` : ''
  return {
    left: `${L.left}px`,
    top: `${L.top}px`,
    width: `${L.width}px`,
    height: `${L.height}px`,
    transform: [rotate, ...flips].join(' ') || undefined,
    opacity: item.opacity ?? 1,
    zIndex: undefined as any,
  }
})

/* ---------------- drag to move ---------------- */
let dragStart: {
  px: number
  py: number
  items: { id: string; left: number; top: number; w: number; h: number; anchor: any }[]
  moved: boolean
} | null = null

function onPointerDown(e: PointerEvent) {
  if (!props.interactive || e.button !== 0) return
  e.stopPropagation()

  const additive = e.shiftKey
  const alreadySelected =
    editor.selectionKind === 'visual' &&
    (editor.selectedIds.includes(props.item._id) || editor.selectedId === props.item._id)

  if (!alreadySelected || additive) editor.selectVisual(props.item._id, additive)
  if (additive) return

  const ids = editor.selectedIds.length ? editor.selectedIds : [props.item._id]
  const items = ids
    .map((id) => {
      const doc = project.visualById(id)
      if (!doc) return null
      const L = effectiveLayout(doc, stageCtx.projW, stageCtx.projH)
      return { id, left: L.left, top: L.top, w: L.width, h: L.height, anchor: L.anchor }
    })
    .filter(Boolean) as any[]

  dragStart = { px: e.clientX, py: e.clientY, items, moved: false }
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
    :class="{ selected: isSelected, interactive }"
    :style="wrapperStyle"
    :data-item-id="item._id"
    @pointerdown="onPointerDown"
    @contextmenu="onContextMenu"
  >
    <div
      class="anim-wrap"
      :style="{
        opacity: animStyle.opacity,
        clipPath: animStyle.clipPath,
        transform: animStyle.transform,
        filter: animStyle.filter,
      }"
    >
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
        />
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
  outline: 1.5px solid rgba(91, 140, 255, 0.55);
  pointer-events: none;
}
.anim-wrap,
.zoom-wrap {
  width: 100%;
  height: 100%;
}
.zoom-wrap {
  transform-origin: center center;
}
.anim-wrap {
  overflow: visible;
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

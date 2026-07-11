<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, provide, reactive } from 'vue'
import { useEditorContext } from '~/composables/useEditorContext'
import { useTemplateVars } from '~/composables/useTemplateVars'
import { effectiveLayout, isVisibleAt } from '~/utils/itemGeometry'
import { clamp } from '~/utils/time'
import type { VisualDoc } from '~/shared/schema/types'
import { xfadeFrame, layerStyle, plateStyle, deviceScale } from '~/utils/xfade'
import { activeGroupFx, type GroupFxResult } from '~/utils/groupTransitions'
import { isStockDrag, parseStockDragData, buildStockVisual } from '~/utils/stockDrag'

const {
  project,
  editor,
  contextVisuals,
  contextDuration,
  contextBackgroundColor,
  scenePlan,
  activeScene,
  displayDefaults,
} = useEditorContext()

/* ---------------- scale / fit ---------------- */
const scrollEl = ref<HTMLElement>()
const avail = ref({ w: 800, h: 500 })
let ro: ResizeObserver | null = null

onMounted(() => {
  ro = new ResizeObserver(() => {
    if (!scrollEl.value) return
    avail.value = {
      w: scrollEl.value.clientWidth,
      h: scrollEl.value.clientHeight,
    }
  })
  if (scrollEl.value) ro.observe(scrollEl.value)
  window.addEventListener('pointermove', onWindowPointerMove)
  window.addEventListener('pointerup', onWindowPointerUp)
})
onBeforeUnmount(() => {
  ro?.disconnect()
  window.removeEventListener('pointermove', onWindowPointerMove)
  window.removeEventListener('pointerup', onWindowPointerUp)
})

const projW = computed(() => displayDefaults.value.width)
const projH = computed(() => displayDefaults.value.height)

const fitScale = computed(() => {
  const pad = 48
  return Math.min(
    (avail.value.w - pad) / projW.value,
    (avail.value.h - pad) / projH.value,
    2
  )
})
const scale = computed(() =>
  editor.stageZoom > 0 ? editor.stageZoom : Math.max(0.02, fitScale.value)
)

function zoomBy(factor: number) {
  const next = clamp(scale.value * factor, 0.05, 4)
  editor.stageZoom = next
}

function onWheel(e: WheelEvent) {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault()
    zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1)
  }
}

/* ---------------- full-movie backdrop (scenes) ----------------
 * The root context of a scenes project always renders the movie itself:
 * in 'scene' (overlays) mode as a read-only backdrop under the editable
 * global overlay track, in 'full' mode as the whole read-only preview. */
const hasMovieBackdrop = computed(
  () => !!project.doc.scenes?.length && editor.context === 'root'
)
const isFullPreview = computed(
  () => hasMovieBackdrop.value && editor.scenePreviewMode === 'full'
)

interface FullEntry {
  entry: import('~/shared/schema/scenePlan').ScenePlanEntry
  localT: number
  visible: boolean
  layer: Record<string, any>
  groupFx: GroupFxResult | null
  key: string
}

const fullPreview = computed(() => {
  if (!hasMovieBackdrop.value || !scenePlan.value)
    return { entries: [] as FullEntry[], plates: [] as Record<string, any>[] }
  const t = editor.playhead
  const entries = scenePlan.value.entries
  const list: FullEntry[] = entries.map((entry) => {
    const localT = t - entry.start
    return {
      entry,
      localT,
      visible: localT >= 0 && localT <= entry.duration,
      layer: {},
      groupFx: null,
      key: entry.scene._id,
    }
  })
  const plates: Record<string, any>[] = []
  // scene→scene xfade: prev scene is stream A, next scene stream B
  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1]
    if (!prev.transition) continue
    const overlap = prev.transitionDuration
    const localT = list[i].localT
    if (!(overlap > 0) || localT < 0 || localT >= overlap) continue
    const frame = xfadeFrame(prev.transition, localT / overlap, {
      mode: 'transition',
      canvasW: projW.value,
      canvasH: projH.value,
      rasterScale: deviceScale(scale.value),
    })
    list[i - 1].layer = layerStyle(frame.a)
    list[i].layer = layerStyle(frame.b)
    if (frame.plate) plates.push(plateStyle(frame.plate))
  }
  // per-scene video↔video linked transitions
  for (const e of list) {
    if (!e.visible) continue
    e.groupFx = activeGroupFx(
      e.entry.scene.visuals,
      e.localT,
      e.entry.duration,
      projW.value,
      projH.value,
      deviceScale(scale.value)
    )
  }
  // every scene stays mounted (hidden via v-show) so its media elements
  // keep their buffers — playback never waits on a scene-entry remount
  return { entries: list, plates }
})

const fullEntries = computed(() => fullPreview.value.entries)
const scenePlates = computed(() => fullPreview.value.plates)

/* ---------------- sorted visuals (track z-order) ---------------- */
function sortByTrack(items: VisualDoc[]) {
  return [...items].sort(
    (a, b) => (a.track ?? 0) - (b.track ?? 0) || (a.enterBegin ?? 0) - (b.enterBegin ?? 0)
  )
}
const sortedVisuals = computed(() => sortByTrack(contextVisuals.value))

/* ---------------- template variables preview (display only) ---------------- */
const tvars = useTemplateVars()

const contextScope = computed(() =>
  activeScene.value
    ? tvars.scenePreviewScope(activeScene.value)
    : tvars.projectScope.value
)

/** what the editing stage renders — resolved copies (condition-falsy items
 *  dimmed, still selectable); the doc keeps raw {{…}} */
const displayedVisuals = computed(() =>
  tvars.displayVisuals(sortedVisuals.value, contextScope.value, {
    dimConditionOff: true,
  })
)

/** global overlays in the full-movie preview: resolved AND pruned — the
 *  full preview shows exactly what renders (scene groups come pre-resolved
 *  from the preview scene plan) */
const overlayVisuals = computed(() =>
  tvars.previewOn.value
    ? sortByTrack(project.resolvedPreviewDoc.visuals)
    : sortedVisuals.value
)

/* video↔video linked transitions in the current editing context */
const contextGroupFx = computed(() =>
  activeGroupFx(
    displayedVisuals.value,
    editor.playhead,
    contextDuration.value,
    projW.value,
    projH.value
  )
)

/* …and for the global overlays of the full preview */
const overlayGroupFx = computed(() =>
  isFullPreview.value
    ? activeGroupFx(
        overlayVisuals.value,
        editor.playhead,
        contextDuration.value,
        projW.value,
        projH.value
      )
    : null
)

const displayContextBg = computed(
  () => tvars.displayString(contextBackgroundColor.value, contextScope.value) ?? '#ffffff'
)

/* ---------------- selection / gestures ---------------- */
interface GuideLine {
  axis: 'v' | 'h'
  pos: number
}
const guides = ref<GuideLine[]>([])

const SNAP_LINES_CACHE = { v: [] as number[], h: [] as number[] }

function collectSnapLines(excludeIds: Set<string>) {
  const v: number[] = [0, projW.value / 2, projW.value]
  const h: number[] = [0, projH.value / 2, projH.value]
  for (const item of contextVisuals.value) {
    if (excludeIds.has(item._id)) continue
    if (!isVisibleAt(item, editor.playhead, contextDuration.value)) continue
    const L = effectiveLayout(item, projW.value, projH.value)
    v.push(L.left, L.left + L.width / 2, L.left + L.width)
    h.push(L.top, L.top + L.height / 2, L.top + L.height)
  }
  SNAP_LINES_CACHE.v = v
  SNAP_LINES_CACHE.h = h
}

function snapBox(
  left: number,
  top: number,
  w: number,
  h: number
): { left: number; top: number } {
  guides.value = []
  if (!editor.snapping) return { left, top }
  const threshold = 6 / scale.value
  const xCandidates = [left, left + w / 2, left + w]
  const yCandidates = [top, top + h / 2, top + h]

  let bestDx: number | null = null
  let bestVLine = 0
  for (const line of SNAP_LINES_CACHE.v) {
    for (const c of xCandidates) {
      const d = line - c
      if (Math.abs(d) <= threshold && (bestDx === null || Math.abs(d) < Math.abs(bestDx))) {
        bestDx = d
        bestVLine = line
      }
    }
  }
  let bestDy: number | null = null
  let bestHLine = 0
  for (const line of SNAP_LINES_CACHE.h) {
    for (const c of yCandidates) {
      const d = line - c
      if (Math.abs(d) <= threshold && (bestDy === null || Math.abs(d) < Math.abs(bestDy))) {
        bestDy = d
        bestHLine = line
      }
    }
  }
  const out = { left: left + (bestDx ?? 0), top: top + (bestDy ?? 0) }
  const g: GuideLine[] = []
  if (bestDx !== null) g.push({ axis: 'v', pos: bestVLine })
  if (bestDy !== null) g.push({ axis: 'h', pos: bestHLine })
  guides.value = g
  return out
}

const stageCtx = reactive({
  get scale() {
    return scale.value
  },
  get projW() {
    return projW.value
  },
  get projH() {
    return projH.value
  },
  get contextDuration() {
    return contextDuration.value
  },
  snapBox,
  collectSnapLines,
  clearGuides: () => (guides.value = []),
  openContextMenu,
})
provide('stageCtx', stageCtx)

/* ---------------- marquee ---------------- */
const marquee = ref<null | { x0: number; y0: number; x1: number; y1: number }>(null)
let marqueeActive = false

function framePoint(e: PointerEvent): { x: number; y: number } {
  const frame = frameEl.value!.getBoundingClientRect()
  return {
    x: (e.clientX - frame.left) / scale.value,
    y: (e.clientY - frame.top) / scale.value,
  }
}

const frameEl = ref<HTMLElement>()

function onFramePointerDown(e: PointerEvent) {
  if (e.button !== 0) return
  // only when clicking the empty frame itself
  if ((e.target as HTMLElement).closest('.stage-item, .sel-box, .ctx-menu')) return
  closeContextMenu()
  const p = framePoint(e)
  marquee.value = { x0: p.x, y0: p.y, x1: p.x, y1: p.y }
  marqueeActive = true
  // empty-stage click: the shared panel shows the project settings
  editor.openProjectSettings()
}

function onWindowPointerMove(e: PointerEvent) {
  if (marqueeActive && marquee.value && frameEl.value) {
    const p = framePoint(e)
    marquee.value.x1 = p.x
    marquee.value.y1 = p.y
  }
}

function onWindowPointerUp() {
  if (marqueeActive && marquee.value) {
    const m = marquee.value
    const rect = {
      left: Math.min(m.x0, m.x1),
      top: Math.min(m.y0, m.y1),
      right: Math.max(m.x0, m.x1),
      bottom: Math.max(m.y0, m.y1),
    }
    if (rect.right - rect.left > 4 || rect.bottom - rect.top > 4) {
      const hits: string[] = []
      for (const item of contextVisuals.value) {
        if (!isVisibleAt(item, editor.playhead, contextDuration.value)) continue
        const L = effectiveLayout(item, projW.value, projH.value)
        if (
          L.left < rect.right &&
          L.left + L.width > rect.left &&
          L.top < rect.bottom &&
          L.top + L.height > rect.top
        )
          hits.push(item._id)
      }
      if (hits.length) {
        editor.selectionKind = 'visual'
        editor.selectedIds = hits
        editor.selectedId = hits[hits.length - 1]
        editor.openInspector()
      }
    }
  }
  marqueeActive = false
  marquee.value = null
}

const marqueeStyle = computed(() => {
  if (!marquee.value) return {}
  const m = marquee.value
  return {
    left: `${Math.min(m.x0, m.x1)}px`,
    top: `${Math.min(m.y0, m.y1)}px`,
    width: `${Math.abs(m.x1 - m.x0)}px`,
    height: `${Math.abs(m.y1 - m.y0)}px`,
  }
})

/* ---------------- stock media drag & drop ---------------- */
const stockDropActive = ref(false)

function onStockDragOver(e: DragEvent) {
  if (!isStockDrag(e)) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  stockDropActive.value = true
}

function onStockDragLeave(e: DragEvent) {
  // only clear when the drag actually leaves the stage area (not a child)
  const to = e.relatedTarget as Node | null
  if (!to || !scrollEl.value?.contains(to)) stockDropActive.value = false
}

function onStockDrop(e: DragEvent) {
  if (!isStockDrag(e)) return
  e.preventDefault()
  stockDropActive.value = false
  const payload = parseStockDragData(e)
  if (!payload || !frameEl.value) return
  if (project.isImage && payload.kind !== 'IMAGE') {
    editor.notify(
      `${payload.kind === 'GIF' ? 'GIFs' : 'Videos'} can't be used in an image project — static sources only`,
      'error'
    )
    return
  }
  const rect = frameEl.value.getBoundingClientRect()
  const at = {
    x: clamp((e.clientX - rect.left) / scale.value, 0, projW.value),
    y: clamp((e.clientY - rect.top) / scale.value, 0, projH.value),
  }
  const visual = buildStockVisual(payload, {
    playhead: editor.playhead,
    contextDuration: contextDuration.value,
    projectWidth: projW.value,
    projectHeight: projH.value,
    at,
  })
  const added = project.addVisual(editor.context, visual)
  editor.selectVisual(added._id)
  editor.openInspector()
  editor.notify(
    `${payload.kind === 'GIF' ? 'GIF' : payload.kind.toLowerCase()} added${project.isImage ? '' : ' at the playhead'}`,
    'success'
  )
}

/* ---------------- context menu ---------------- */
const ctxMenu = ref<null | { x: number; y: number; id: string }>(null)
function openContextMenu(e: MouseEvent, id: string) {
  ctxMenu.value = { x: e.clientX, y: e.clientY, id }
}
function closeContextMenu() {
  ctxMenu.value = null
}

/* ---------------- selection bookkeeping ---------------- */
const selectedVisuals = computed<VisualDoc[]>(() => {
  if (editor.selectionKind !== 'visual') return []
  const ids = new Set(editor.selectedIds.length ? editor.selectedIds : [editor.selectedId!])
  return contextVisuals.value.filter((v) => ids.has(v._id))
})

const contextLabel = computed(() => {
  if (activeScene.value) return `Scene: ${activeScene.value.id}`
  if (project.doc.scenes?.length) return 'Global overlays'
  return null
})
</script>

<template>
  <div class="stage-wrap">
    <div v-if="contextLabel" class="ctx-banner">
      <UiIcon name="scene" :size="12" />
      {{ contextLabel }}
      <template v-if="isFullPreview"
        ><span class="sep">·</span> full-movie preview (read-only) — pick a scene to
        edit</template
      >
      <template v-else-if="hasMovieBackdrop"
        ><span class="sep">·</span> editable over the full movie — pick a scene to
        edit its content</template
      >
    </div>
    <div
      ref="scrollEl"
      class="stage-scroll checkerboard"
      :class="{ 'stock-drop': stockDropActive }"
      @wheel="onWheel"
      @dragover="onStockDragOver"
      @dragleave="onStockDragLeave"
      @drop="onStockDrop"
    >
      <div
        class="stage-outer"
        :style="{
          width: `${projW * scale}px`,
          height: `${projH * scale}px`,
        }"
      >
        <div
          ref="frameEl"
          class="stage-frame"
          :style="{
            width: `${projW}px`,
            height: `${projH}px`,
            transform: `scale(${scale})`,
            background: hasMovieBackdrop ? 'transparent' : displayContextBg,
          }"
          @pointerdown="onFramePointerDown"
        >
          <!-- the movie itself: scene groups, always under the overlay track -->
          <template v-if="hasMovieBackdrop">
            <!-- scene-transition fade-through-color plates (under both scenes) -->
            <div
              v-for="(ps, i) in scenePlates"
              :key="`plate-${i}`"
              class="fx-plate"
              :style="ps"
            />
            <div
              v-for="fe in fullEntries"
              v-show="fe.visible"
              :key="fe.key"
              class="scene-group"
              :style="{ background: fe.entry.backgroundColor, ...fe.layer }"
            >
              <div
                v-for="(ps, i) in fe.groupFx?.plates ?? []"
                :key="`gplate-${i}`"
                class="fx-plate"
                :style="plateStyle(ps)"
              />
              <StageItem
                v-for="item in sortByTrack(fe.entry.scene.visuals)"
                :key="item._id"
                :item="item"
                :time="fe.localT"
                :context-duration="fe.entry.duration"
                :interactive="false"
                :group-fx="fe.groupFx?.styleById.get(item._id) ?? null"
              />
            </div>
          </template>

          <!-- global overlays, read-only (full-movie preview) -->
          <template v-if="isFullPreview">
            <div
              v-for="(ps, i) in overlayGroupFx?.plates ?? []"
              :key="`oplate-${i}`"
              class="fx-plate"
              :style="plateStyle(ps)"
            />
            <StageItem
              v-for="item in overlayVisuals"
              :key="item._id"
              :item="item"
              :time="editor.playhead"
              :context-duration="contextDuration"
              :interactive="false"
              :group-fx="overlayGroupFx?.styleById.get(item._id) ?? null"
            />
          </template>

          <!-- editing context (flat project, a scene, or the overlay track) -->
          <template v-else>
            <!-- video↔video transition plates (full-frame xfade canvas) -->
            <div
              v-for="(ps, i) in contextGroupFx?.plates ?? []"
              :key="`cplate-${i}`"
              class="fx-plate"
              :style="plateStyle(ps)"
            />
            <StageItem
              v-for="item in displayedVisuals"
              :key="item._id"
              :item="item"
              :time="editor.playhead"
              :context-duration="contextDuration"
              :interactive="true"
              :group-fx="contextGroupFx?.styleById.get(item._id) ?? null"
            />
          </template>

          <StageSubtitleOverlay
            v-if="editor.context === 'root'"
            :time="editor.playhead"
          />

          <!-- safe margins -->
          <div v-if="editor.showSafeArea" class="safe-area" />

          <!-- snap guides -->
          <div
            v-for="(g, i) in guides"
            :key="i"
            class="guide"
            :class="g.axis"
            :style="
              g.axis === 'v'
                ? { left: `${g.pos}px` }
                : { top: `${g.pos}px` }
            "
          />

          <!-- selection handles -->
          <StageSelection
            v-for="v in selectedVisuals"
            :key="`sel-${v._id}`"
            :item="v"
            :primary="v._id === editor.selectedId"
          />

          <!-- marquee -->
          <div v-if="marquee" class="marquee" :style="marqueeStyle" />
        </div>
      </div>
    </div>

    <div class="stage-foot">
      <div class="foot-left">
        <button
          class="icon-btn"
          :class="{ active: editor.showSafeArea }"
          title="Toggle safe margins"
          @click="editor.showSafeArea = !editor.showSafeArea"
        >
          <UiIcon name="grid" />
        </button>
        <button
          class="icon-btn"
          :class="{ active: editor.snapping }"
          title="Toggle snapping"
          @click="editor.snapping = !editor.snapping"
        >
          <UiIcon name="anchor" />
        </button>
      </div>
      <div class="foot-right">
        <button class="icon-btn" title="Zoom out (Ctrl+scroll)" @click="zoomBy(1 / 1.2)">
          <UiIcon name="minus" />
        </button>
        <button
          class="zoom-label"
          title="Reset to fit"
          @click="editor.stageZoom = 0"
        >
          {{ Math.round(scale * 100) }}%
        </button>
        <button class="icon-btn" title="Zoom in (Ctrl+scroll)" @click="zoomBy(1.2)">
          <UiIcon name="plus" />
        </button>
      </div>
    </div>

    <StageContextMenu
      v-if="ctxMenu"
      :x="ctxMenu.x"
      :y="ctxMenu.y"
      :item-id="ctxMenu.id"
      @close="closeContextMenu"
    />
  </div>
</template>

<style scoped>
.stage-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  position: relative;
  background: var(--bg-0);
}
.ctx-banner {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  font-size: 11px;
  color: var(--accent-strong);
  background: var(--accent-soft);
  border-bottom: 1px solid var(--border-0);
  flex: 0 0 auto;
}
.ctx-banner .sep {
  color: var(--text-3);
}
.stage-scroll {
  flex: 1;
  overflow: auto;
  display: grid;
  place-items: center;
  min-height: 0;
  position: relative;
}
.stage-outer {
  position: relative;
  margin: 24px;
  flex: 0 0 auto;
}
.stage-frame {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: top left;
  overflow: hidden;
  box-shadow: 0 0 0 1px var(--border-1), var(--shadow-2);
}
.stage-scroll.stock-drop {
  outline: 2px dashed var(--accent);
  outline-offset: -2px;
}
.stage-scroll.stock-drop .stage-frame {
  box-shadow: 0 0 0 2px var(--accent), var(--shadow-2);
}
.scene-group {
  position: absolute;
  inset: 0;
  /* scenes are read-only here — let clicks fall through to the editable
     overlay items and the frame (marquee / deselect) */
  pointer-events: none;
}
.fx-plate {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
/* guides sit over arbitrary video content — pair light dashes with a dark
   halo so they read on any footage, in either app theme */
.safe-area {
  position: absolute;
  inset: 5%;
  border: 1px dashed rgba(255, 255, 255, 0.55);
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.22),
    inset 0 0 0 1px rgba(0, 0, 0, 0.22);
  pointer-events: none;
}
.safe-area::after {
  content: '';
  position: absolute;
  inset: 5%;
  border: 1px dashed rgba(255, 255, 255, 0.3);
}
.guide {
  position: absolute;
  background: var(--cyan);
  pointer-events: none;
  z-index: 999;
}
.guide.v {
  top: 0;
  bottom: 0;
  width: 1px;
}
.guide.h {
  left: 0;
  right: 0;
  height: 1px;
}
.marquee {
  position: absolute;
  border: 1px solid var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  pointer-events: none;
  z-index: 999;
}
.stage-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 34px;
  padding: 0 10px;
  border-top: 1px solid var(--border-0);
  background: var(--bg-1);
  flex: 0 0 auto;
}
.foot-left,
.foot-right {
  display: flex;
  align-items: center;
  gap: 4px;
}
.zoom-label {
  background: none;
  border: none;
  color: var(--text-1);
  font-size: 11.5px;
  min-width: 44px;
  font-variant-numeric: tabular-nums;
}
.zoom-label:hover {
  color: var(--text-0);
}
</style>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useEditorContext } from '~/composables/useEditorContext'
import { usePlayheadJumps } from '~/composables/usePlayheadJumps'
import { resolveVisualTiming, resolveAudioTiming } from '~/shared/schema/defaults'
import { useMediaProbe } from '~/composables/useMediaProbe'
import { contentDuration, projectContentDuration } from '~/shared/schema/scenePlan'
import { formatTime, clamp, round3 } from '~/utils/time'
import { snapTimelineTime } from '~/utils/timelineSnap'
import {
  TIMELINE_DEFAULT_MIN_PX_PER_SEC,
  TIMELINE_HEADER_WIDTH,
  timelineZoomFloor,
} from '~/utils/timelineZoom'

const {
  project,
  editor,
  contextDuration,
  contextVisuals,
  contextAudios,
  activeScene,
  scenePlan,
  totalDuration,
} = useEditorContext()
const { probe, probeDuration } = useMediaProbe()
const { jumpBack, jumpForward } = usePlayheadJumps()

/* ---------------- geometry ---------------- */
const HEADER_W = TIMELINE_HEADER_WIDTH
const pxPerSec = computed(() => editor.pxPerSec)

/** Where the last clip actually ends (0 when the context is empty). An item
 *  without an explicit exitEnd legitimately runs to contextDuration. */
const lastClipEnd = computed(() => {
  let end = 0
  for (const v of contextVisuals.value) {
    end = Math.max(end, resolveVisualTiming(v, contextDuration.value).exitEnd)
  }
  for (const a of contextAudios.value) {
    const src = a.src ? probe('audio', a.src) : null
    end = Math.max(
      end,
      resolveAudioTiming(a, contextDuration.value, src?.duration).exit
    )
  }
  return end
})

/** Subtitles are a root-only lane, so their blocks must participate in the
 *  root fit calculation even when a caption extends past every media clip. */
const lastCaptionEnd = computed(() => {
  if (editor.context !== 'root') return 0

  let end = 0
  for (const caption of project.doc.subtitle?.captions ?? []) {
    if (Number.isFinite(caption.end)) end = Math.max(end, caption.end)
  }
  return end
})

const contentEnd = computed(() =>
  Math.max(contextDuration.value, lastClipEnd.value, lastCaptionEnd.value)
)
const independentEnd = computed(() => activeScene.value
  ? contentDuration(activeScene.value, probeDuration)
  : projectContentDuration(project.resolvedPreviewDoc, probeDuration))

const contentWidth = computed(
  () => Math.max(contentEnd.value, contextDuration.value) * pxPerSec.value + 260
)

/* The old fixed 8px/s floor cannot show a long project end in a normal
   viewport. Keep 8px/s for short projects, but lower the floor just enough
   for the real content endpoint to fit (the trailing drag padding may scroll). */
const timelineViewportWidth = ref(0)
const minPxPerSec = computed(() =>
  timelineZoomFloor(timelineViewportWidth.value, contentEnd.value)
)
let timelineResizeObserver: ResizeObserver | null = null

function measureTimelineViewport() {
  const width = scrollEl.value?.clientWidth ?? 0
  // v-show makes the element width zero while collapsed; retain the last
  // usable width so collapsing the panel does not reset a user's zoom.
  if (width > 0) timelineViewportWidth.value = width
}

onMounted(() => {
  timelineResizeObserver = new ResizeObserver(measureTimelineViewport)
  if (scrollEl.value) timelineResizeObserver.observe(scrollEl.value)
  measureTimelineViewport()
})

onBeforeUnmount(() => {
  timelineResizeObserver?.disconnect()
  editor.setTimelineZoomMin(TIMELINE_DEFAULT_MIN_PX_PER_SEC)
})

watch(minPxPerSec, (min) => editor.setTimelineZoomMin(min), { immediate: true })

/* ---------------- lanes ---------------- */
const visualLanes = computed<number[]>(() => {
  const tracks = new Set<number>(editor.extraVisualTracks)
  for (const v of contextVisuals.value) tracks.add(v.track ?? 0)
  if (!tracks.size) tracks.add(0)
  return [...tracks].sort((a, b) => b - a) // higher track on top
})

const audioLanes = computed<number[]>(() => {
  const tracks = new Set<number>(editor.extraAudioTracks)
  for (const a of contextAudios.value) tracks.add(a.track ?? 0)
  if (!tracks.size) tracks.add(0)
  return [...tracks].sort((a, b) => a - b)
})

function visualsInLane(track: number) {
  return contextVisuals.value.filter((v) => (v.track ?? 0) === track)
}
function audiosInLane(track: number) {
  return contextAudios.value.filter((a) => (a.track ?? 0) === track)
}

function addVisualLane() {
  const next = Math.max(-1, ...visualLanes.value) + 1
  if (!editor.extraVisualTracks.includes(next)) editor.extraVisualTracks.push(next)
}
function addAudioLane() {
  const next = Math.max(-1, ...audioLanes.value) + 1
  if (!editor.extraAudioTracks.includes(next)) editor.extraAudioTracks.push(next)
}

/* empty lanes only exist through the extra-track lists (or the lane-0
   fallback) — deleting one is just forgetting the extra entry */
function canRemoveVisualLane(track: number): boolean {
  return !visualsInLane(track).length && editor.extraVisualTracks.includes(track)
}
function canRemoveAudioLane(track: number): boolean {
  return !audiosInLane(track).length && editor.extraAudioTracks.includes(track)
}
function removeVisualLane(track: number) {
  editor.extraVisualTracks = editor.extraVisualTracks.filter((t) => t !== track)
}
function removeAudioLane(track: number) {
  editor.extraAudioTracks = editor.extraAudioTracks.filter((t) => t !== track)
}

/* ---------------- clip context menu (same menu as the stage) ---------------- */
const ctxMenu = ref<null | { x: number; y: number; id: string; kind: 'visual' | 'audio' }>(
  null
)
function openClipMenu(e: MouseEvent, id: string, kind: 'visual' | 'audio') {
  ctxMenu.value = { x: e.clientX, y: e.clientY, id, kind }
}

/* ---------------- snapping targets ---------------- */
function snapTargets(excludeId?: string): number[] {
  const followsContent = activeScene.value
    ? (activeScene.value.duration ?? -1) === -1
    : project.doc.durationMode === 'auto'
  const pts = [0, editor.playhead]
  // A derived end follows the dragged clip. Snapping back to it on every
  // pointermove makes slow trims sticky and leaves fractional end times.
  if (!followsContent) pts.push(contextDuration.value)
  if (!activeScene.value) {
    if (scenePlan.value) pts.push(scenePlan.value.totalScenesDuration)
    const minimum = project.resolvedPreviewDoc.duration
    if (typeof minimum === 'number') pts.push(minimum)
  }
  for (const v of contextVisuals.value) {
    if (v._id === excludeId) continue
    const t = resolveVisualTiming(v, contextDuration.value)
    pts.push(t.enterBegin)
    if (!followsContent || typeof v.exitEnd === 'number') pts.push(t.exitEnd)
  }
  for (const a of contextAudios.value) {
    if (a._id === excludeId) continue
    const src = a.src ? probe('audio', a.src) : null
    const t = resolveAudioTiming(a, contextDuration.value, src?.duration)
    pts.push(t.enter)
    if (
      !followsContent ||
      (!a.matchDuration &&
        (typeof a.exit === 'number' ||
          typeof a.audioEnd === 'number' ||
          typeof src?.duration === 'number'))
    ) {
      pts.push(t.exit)
    }
  }
  return pts
}

function snapTime(t: number, excludeId?: string): number {
  return snapTimelineTime(t, {
    enabled: editor.snapping,
    targets: snapTargets(excludeId),
    pxPerSec: pxPerSec.value,
    frameRate: project.defaults.frameRate,
  })
}

/* ---------------- scrubbing ---------------- */
const scrollEl = ref<HTMLElement>()
let scrubbing = false

function timeAtClientX(clientX: number): number {
  const el = scrollEl.value!
  const rect = el.getBoundingClientRect()
  const x = clientX - rect.left + el.scrollLeft - HEADER_W
  return clamp(x / pxPerSec.value, 0, contentEnd.value + 5)
}

function onRulerDown(e: PointerEvent) {
  if (e.button !== 0) return
  e.preventDefault()
  scrubbing = true
  editor.seek(timeAtClientX(e.clientX), contextDuration.value)
  window.addEventListener('pointermove', onScrubMove)
  window.addEventListener('pointerup', onScrubUp)
  window.addEventListener('pointercancel', onScrubUp)
  window.addEventListener('blur', onScrubUp)
}
function onScrubMove(e: PointerEvent) {
  if (scrubbing) editor.seek(timeAtClientX(e.clientX), contextDuration.value)
}
function onScrubUp() {
  scrubbing = false
  window.removeEventListener('pointermove', onScrubMove)
  window.removeEventListener('pointerup', onScrubUp)
  window.removeEventListener('pointercancel', onScrubUp)
  window.removeEventListener('blur', onScrubUp)
}
onBeforeUnmount(onScrubUp)

function onWheel(e: WheelEvent) {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault()
    const el = scrollEl.value!
    const mouseT =
      (e.clientX - el.getBoundingClientRect().left + el.scrollLeft - HEADER_W) /
      pxPerSec.value
    editor.setZoom(pxPerSec.value * (e.deltaY < 0 ? 1.2 : 1 / 1.2))
    requestAnimationFrame(() => {
      el.scrollLeft =
        mouseT * editor.pxPerSec - (e.clientX - el.getBoundingClientRect().left) + HEADER_W
    })
  }
}

/* keep playhead visible while playing */
watch(
  () => editor.playhead,
  (t) => {
    if (!editor.playing || !scrollEl.value) return
    const el = scrollEl.value
    const x = t * pxPerSec.value + HEADER_W
    if (x < el.scrollLeft + HEADER_W || x > el.scrollLeft + el.clientWidth - 60) {
      el.scrollLeft = Math.max(0, x - HEADER_W - 40)
    }
  }
)

/* ---------------- transport actions ---------------- */
function fitDurationToContent() {
  // fit to the real last clip end so the duration can shrink, not only grow
  const target = round3(independentEnd.value)
  if (target <= 0) {
    editor.notify('Nothing on the timeline to fit the duration to', 'info')
    return
  }
  if (activeScene.value) {
    if (activeScene.value.duration !== undefined && activeScene.value.duration !== -1) {
      project.patchScene(activeScene.value._id, { duration: target })
    }
  } else {
    project.patchProject(project.doc.durationMode === 'auto' ? { duration: undefined } : { duration: target })
  }
  editor.notify(`Duration set to ${target}s`, 'success')
}

const overDuration = computed(() => independentEnd.value > contextDuration.value + 0.001)

const hasScenes = computed(() => !!project.doc.scenes?.length)
</script>

<template>
  <div class="tl-panel" :class="{ collapsed: editor.timelineCollapsed }">
    <!-- transport -->
    <div class="transport">
      <div class="tp-left">
        <div class="playback-controls">
          <button
            class="icon-btn"
            title="Previous start point (Home)"
            @click="jumpBack()"
          >
            <UiIcon name="skip-start" />
          </button>
          <button
            class="icon-btn"
            title="Previous frame"
            @click="editor.seek(editor.playhead - 1 / project.defaults.frameRate, contextDuration)"
          >
            <UiIcon name="chevron_left" />
          </button>
          <button
            class="icon-btn play-btn"
            :title="editor.playing ? 'Pause (Space)' : 'Play (Space)'"
            @click="editor.togglePlay()"
          >
            <UiIcon :name="editor.playing ? 'pause' : 'play'" :size="17" />
          </button>
          <button
            class="icon-btn"
            title="Next frame"
            @click="editor.seek(editor.playhead + 1 / project.defaults.frameRate, contextDuration)"
          >
            <UiIcon name="chevron_right" />
          </button>
          <button
            class="icon-btn"
            title="Next start point (End)"
            @click="jumpForward()"
          >
            <UiIcon name="skip-end" />
          </button>
          <button
            class="icon-btn"
            :class="{ active: editor.loop }"
            title="Loop (L)"
            @click="editor.loop = !editor.loop"
          >
            <UiIcon name="loop" />
          </button>
          <button
            class="icon-btn"
            :class="{ active: !editor.muted }"
            title="Mute (M)"
            @click="editor.muted = !editor.muted"
          >
            <UiIcon :name="editor.muted ? 'mute' : 'volume'" />
          </button>
        </div>
        <span class="time mono">
          {{ formatTime(editor.playhead) }}
          <span class="time-total">/ {{ formatTime(contextDuration) }}</span>
          <span v-if="activeScene" class="time-total"> · Project {{ formatTime(totalDuration) }}</span>
        </span>
      </div>
      <div class="tp-right">
        <span
          v-if="overDuration"
          class="over-badge"
          title="Content extends beyond the set length and will be cut off"
        >
          <UiIcon name="warning" :size="11" />
          content exceeds duration
          <button class="link" @click="fitDurationToContent">{{ activeScene ? 'Extend scene to fit' : 'Extend project to fit' }}</button>
        </span>
        <button
          v-else
          class="btn ghost sm"
          title="Fit scenes, timed elements, audio and captions; remove extra time"
          @click="fitDurationToContent"
        >
          Fit duration
        </button>
        <template v-if="hasScenes && editor.context === 'root'">
          <div class="seg">
            <button
              :class="{ on: editor.scenePreviewMode === 'scene' }"
              title="Edit the global overlay track over the full movie"
              @click="editor.setScenePreviewMode('scene')"
            >
              overlays
            </button>
            <button
              :class="{ on: editor.scenePreviewMode === 'full' }"
              title="Preview the full movie with scene transitions (read-only)"
              @click="editor.setScenePreviewMode('full')"
            >
              full movie
            </button>
          </div>
        </template>
        <template v-if="!editor.timelineCollapsed">
          <UiIcon name="zoom" :size="13" class="dim" />
          <input
            type="range"
            :min="minPxPerSec"
            max="400"
            step="any"
            :value="editor.pxPerSec"
            title="Timeline zoom (Ctrl+scroll)"
            @input="editor.setZoom(Number(($event.target as HTMLInputElement).value))"
          />
        </template>
        <button
          class="icon-btn"
          :title="editor.timelineCollapsed ? 'Expand timeline' : 'Collapse timeline'"
          @click="editor.toggleTimeline()"
        >
          <UiIcon :name="editor.timelineCollapsed ? 'chevron_up' : 'chevron_down'" />
        </button>
      </div>
    </div>

    <!-- lanes -->
    <div v-show="!editor.timelineCollapsed" ref="scrollEl" class="tl-scroll" @wheel="onWheel">
      <div class="tl-content" :style="{ width: `${contentWidth + HEADER_W}px` }">
        <!-- ruler row -->
        <div class="tl-row ruler-row">
          <div class="tl-header ruler-header">
            <span class="mono dim">{{ Math.round(editor.pxPerSec) }}px/s</span>
          </div>
          <div class="lane ruler-lane" @pointerdown="onRulerDown">
            <TimelineTimeRuler
              :width="contentWidth"
              :px-per-sec="pxPerSec"
              :duration="contextDuration"
            />
          </div>
        </div>

        <!-- scene strip -->
        <TimelineSceneStrip v-if="hasScenes" :header-w="HEADER_W" :px-per-sec="pxPerSec" />

        <!-- visual lanes -->
        <div v-for="track in visualLanes" :key="`v${track}`" class="tl-row">
          <div class="tl-header">
            <span class="lane-badge video">V{{ track }}</span>
            <span class="lane-count">{{ visualsInLane(track).length }}</span>
            <button
              v-if="canRemoveVisualLane(track)"
              class="icon-btn xs lane-remove"
              title="Delete empty track"
              @click="removeVisualLane(track)"
            >
              <UiIcon name="trash" :size="13" />
            </button>
          </div>
          <div class="lane" :data-track="track">
            <div
              v-if="!activeScene"
              class="duration-shade"
              :style="{ left: `${contextDuration * pxPerSec}px` }"
            />
            <TimelineClip
              v-for="item in visualsInLane(track)"
              :key="item._id"
              :item="item"
              :px-per-sec="pxPerSec"
              :context-duration="contextDuration"
              :lanes="visualLanes"
              :snap="snapTime"
              @ctxmenu="openClipMenu($event, item._id, 'visual')"
            />
          </div>
        </div>
        <div class="tl-row add-row">
          <div class="tl-header">
            <button class="btn ghost sm" @click="addVisualLane">
              <UiIcon name="plus" :size="12" /> track
            </button>
          </div>
          <div class="lane empty-lane" />
        </div>

        <!-- audio lanes -->
        <div v-for="track in audioLanes" :key="`a${track}`" class="tl-row">
          <div class="tl-header">
            <span class="lane-badge audio">A{{ track }}</span>
            <span class="lane-count">{{ audiosInLane(track).length }}</span>
            <button
              v-if="canRemoveAudioLane(track)"
              class="icon-btn xs lane-remove"
              title="Delete empty track"
              @click="removeAudioLane(track)"
            >
              <UiIcon name="trash" :size="13" />
            </button>
          </div>
          <div class="lane audio-lane" :data-audio-track="track">
            <div
              v-if="!activeScene"
              class="duration-shade"
              :style="{ left: `${contextDuration * pxPerSec}px` }"
            />
            <TimelineAudioClip
              v-for="a in audiosInLane(track)"
              :key="a._id"
              :audio="a"
              :px-per-sec="pxPerSec"
              :context-duration="contextDuration"
              :lanes="audioLanes"
              :snap="snapTime"
              @ctxmenu="openClipMenu($event, a._id, 'audio')"
            />
          </div>
        </div>
        <div class="tl-row add-row">
          <div class="tl-header">
            <button class="btn ghost sm" @click="addAudioLane">
              <UiIcon name="plus" :size="12" /> audio
            </button>
          </div>
          <div class="lane empty-lane" />
        </div>

        <!-- subtitles lane (root only) -->
        <TimelineSubtitleLane
          v-if="editor.context === 'root'"
          :header-w="HEADER_W"
          :px-per-sec="pxPerSec"
        />

        <!-- playhead -->
        <div
          class="playhead"
          :style="{ left: `${HEADER_W + editor.playhead * pxPerSec}px` }"
        >
          <div class="playhead-grip" @pointerdown.stop="onRulerDown" />
        </div>
      </div>
    </div>

    <StageContextMenu
      v-if="ctxMenu"
      :x="ctxMenu.x"
      :y="ctxMenu.y"
      :item-id="ctxMenu.id"
      :kind="ctxMenu.kind"
      @close="ctxMenu = null"
    />
  </div>
</template>

<style scoped>
.tl-panel {
  height: min(292px, 38dvh);
  min-width: 0;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--border-0);
  background: var(--bg-1);
  flex: 0 0 auto;
}
/* collapsed: only the transport bar remains; the stage gets the height */
.tl-panel.collapsed {
  height: auto;
}
.transport {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 38px;
  padding: 3px 10px;
  border-bottom: 1px solid var(--border-0);
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: 4px 12px;
}
.tl-panel.collapsed .transport {
  border-bottom: none;
}
.tp-left,
.tp-right {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex-wrap: wrap;
}
.tp-left {
  flex: 1 1 auto;
}
.tp-right {
  margin-left: auto;
}
.playback-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
}
.tp-right input[type='range'] {
  width: 100px;
  min-width: 60px;
}
.play-btn {
  width: 34px;
  height: 34px;
  background: var(--accent);
  color: #fff;
  border-radius: 50%;
  box-shadow: 0 2px 8px color-mix(in srgb, var(--accent) 40%, transparent);
}
.play-btn:hover {
  background: var(--accent-strong);
  color: #fff;
}
.time {
  font-size: 12.5px;
  margin-left: 8px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.time-total {
  color: var(--text-3);
}
.over-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-left: 8px;
  padding: 2px 8px;
  font-size: 11px;
  color: var(--yellow);
  background: color-mix(in srgb, var(--yellow) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--yellow) 35%, transparent);
  border-radius: 999px;
  flex-wrap: wrap;
}
.link {
  background: none;
  border: none;
  color: var(--accent);
  font-size: 11px;
  text-decoration: underline;
  padding: 0;
}
.seg {
  display: flex;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-s);
  overflow: hidden;
  margin-right: 6px;
}
.seg button {
  border: none;
  background: var(--bg-2);
  color: var(--text-2);
  font-size: 11px;
  padding: 4px 10px;
}
.seg button.on {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}
.dim {
  color: var(--text-3);
}
.tl-scroll {
  flex: 1;
  overflow: auto;
  position: relative;
  min-height: 0;
}
.tl-content {
  position: relative;
  min-height: 100%;
}
.tl-row {
  display: flex;
  min-height: 40px;
  border-bottom: 1px solid var(--border-0);
}
.tl-row.add-row {
  min-height: 26px;
  border-bottom-color: transparent;
}
.ruler-row {
  position: sticky;
  top: 0;
  z-index: 30;
  min-height: 26px;
  background: var(--bg-2);
}
.tl-header {
  position: sticky;
  left: 0;
  z-index: 20;
  width: 148px;
  flex: 0 0 148px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 10px;
  background: var(--bg-2);
  border-right: 1px solid var(--border-0);
}
.ruler-header {
  justify-content: flex-end;
}
.ruler-header .mono {
  font-size: 10px;
}
.lane {
  position: relative;
  flex: 1;
  min-width: 0;
}
.ruler-lane {
  touch-action: none;
  cursor: col-resize;
}
.audio-lane {
  background: var(--audio-lane-tint);
}
.empty-lane {
  opacity: 0.4;
}
.lane-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
  letter-spacing: 0.04em;
}
.lane-badge.video {
  background: color-mix(in srgb, var(--clip-video) 15%, transparent);
  color: color-mix(in srgb, var(--clip-video) 75%, var(--text-0));
}
.lane-badge.audio {
  background: color-mix(in srgb, var(--clip-audio) 14%, transparent);
  color: color-mix(in srgb, var(--clip-audio) 75%, var(--text-0));
}
.lane-count {
  font-size: 10px;
  color: var(--text-3);
}
.lane-remove {
  margin-left: auto;
  color: var(--text-2);
}
.lane-remove:hover {
  color: var(--red);
}
.duration-shade {
  position: absolute;
  top: 0;
  bottom: 0;
  right: 0;
  background: repeating-linear-gradient(
    -45deg,
    color-mix(in srgb, var(--red) 6%, transparent),
    color-mix(in srgb, var(--red) 6%, transparent) 6px,
    transparent 6px,
    transparent 12px
  );
  border-left: 1px dashed color-mix(in srgb, var(--red) 50%, transparent);
  pointer-events: none;
}
.playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 0;
  border-left: 1.5px solid var(--playhead);
  z-index: 25;
  pointer-events: none;
}
.playhead-grip {
  touch-action: none;
  position: sticky;
  top: 3px;
  margin-left: -5.5px;
  width: 11px;
  height: 15px;
  background: var(--playhead);
  border-radius: 4px 4px 5px 5px;
  clip-path: polygon(0 0, 100% 0, 100% 62%, 50% 100%, 0 62%);
  pointer-events: auto;
  cursor: col-resize;
}
@media (max-width: 1100px) {
  .transport {
    padding: 4px 8px;
  }
  .time {
    margin-left: 0;
    font-size: 11px;
  }
  .over-badge {
    margin-left: 0;
  }
}
@media (max-width: 767px) {
  .tl-panel {
    height: min(248px, 34dvh);
  }
  .tp-left,
  .tp-right {
    gap: 4px;
  }
  .playback-controls {
    gap: 3px;
  }
  .playback-controls .icon-btn {
    width: 30px;
    height: 34px;
  }
  .playback-controls .play-btn {
    width: 34px;
  }
  .time {
    font-size: 10px;
  }
  .seg {
    margin-right: 0;
  }
  .tp-right input[type='range'] {
    width: 76px;
  }
}
</style>

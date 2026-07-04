<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useEditorContext } from '~/composables/useEditorContext'
import { resolveVisualTiming, resolveAudioTiming } from '~/shared/schema/defaults'
import { useMediaProbe } from '~/composables/useMediaProbe'
import { formatTime, clamp, round3 } from '~/utils/time'

const {
  project,
  editor,
  contextDuration,
  contextVisuals,
  contextAudios,
  activeScene,
} = useEditorContext()
const { probe } = useMediaProbe()

/* ---------------- geometry ---------------- */
const HEADER_W = 148
const pxPerSec = computed(() => editor.pxPerSec)

const contentEnd = computed(() => {
  let end = contextDuration.value
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

const contentWidth = computed(
  () => Math.max(contentEnd.value, contextDuration.value) * pxPerSec.value + 260
)

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
  const pts = [0, contextDuration.value, editor.playhead]
  for (const v of contextVisuals.value) {
    if (v._id === excludeId) continue
    const t = resolveVisualTiming(v, contextDuration.value)
    pts.push(t.enterBegin, t.exitEnd)
  }
  for (const a of contextAudios.value) {
    if (a._id === excludeId) continue
    const src = a.src ? probe('audio', a.src) : null
    const t = resolveAudioTiming(a, contextDuration.value, src?.duration)
    pts.push(t.enter, t.exit)
  }
  return pts
}

function snapTime(t: number, excludeId?: string): number {
  const fps = project.defaults.frameRate
  if (!editor.snapping) return round3(Math.max(0, t))
  const threshold = 7 / pxPerSec.value
  let best = t
  let bestD = threshold
  for (const p of snapTargets(excludeId)) {
    const d = Math.abs(p - t)
    if (d < bestD) {
      bestD = d
      best = p
    }
  }
  if (best === t) best = Math.round(t * fps) / fps // frame grid
  return round3(Math.max(0, best))
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
  scrubbing = true
  editor.seek(timeAtClientX(e.clientX), contextDuration.value)
  window.addEventListener('pointermove', onScrubMove)
  window.addEventListener('pointerup', onScrubUp)
}
function onScrubMove(e: PointerEvent) {
  if (scrubbing) editor.seek(timeAtClientX(e.clientX), contextDuration.value)
}
function onScrubUp() {
  scrubbing = false
  window.removeEventListener('pointermove', onScrubMove)
  window.removeEventListener('pointerup', onScrubUp)
}

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
  if (activeScene.value) {
    project.patchScene(activeScene.value._id, { duration: round3(contentEnd.value) })
  } else {
    project.patchProject({ duration: round3(contentEnd.value) })
  }
  editor.notify(`Duration set to ${round3(contentEnd.value)}s`, 'success')
}

const overDuration = computed(() => contentEnd.value > contextDuration.value + 0.001)

const hasScenes = computed(() => !!project.doc.scenes?.length)
</script>

<template>
  <div class="tl-panel">
    <!-- transport -->
    <div class="transport">
      <div class="tp-left">
        <button class="icon-btn" title="Jump to start (Home)" @click="editor.seek(0)">
          <UiIcon name="skip-start" />
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
          title="Jump to end (End)"
          @click="editor.seek(contextDuration, contextDuration)"
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
        <span class="time mono">
          {{ formatTime(editor.playhead, project.defaults.frameRate) }}
          <span class="time-total">/ {{ formatTime(contextDuration) }}</span>
        </span>
        <span
          v-if="overDuration && !activeScene"
          class="over-badge"
          title="Clips extend past the project duration — the render will cut them off"
        >
          <UiIcon name="warning" :size="11" />
          content exceeds duration
          <button class="link" @click="fitDurationToContent">fit</button>
        </span>
        <button
          v-else
          class="btn ghost sm"
          title="Set duration to the last clip's end"
          @click="fitDurationToContent"
        >
          Fit duration
        </button>
      </div>
      <div class="tp-right">
        <template v-if="hasScenes && editor.context === 'root'">
          <div class="seg">
            <button
              :class="{ on: editor.scenePreviewMode === 'scene' }"
              title="Edit global overlay track"
              @click="editor.scenePreviewMode = 'scene'"
            >
              overlays
            </button>
            <button
              :class="{ on: editor.scenePreviewMode === 'full' }"
              title="Preview the full movie with scene transitions"
              @click="editor.scenePreviewMode = 'full'"
            >
              full movie
            </button>
          </div>
        </template>
        <UiIcon name="zoom" :size="13" class="dim" />
        <input
          type="range"
          min="8"
          max="400"
          :value="editor.pxPerSec"
          title="Timeline zoom (Ctrl+scroll)"
          @input="editor.setZoom(Number(($event.target as HTMLInputElement).value))"
        />
      </div>
    </div>

    <!-- lanes -->
    <div ref="scrollEl" class="tl-scroll" @wheel="onWheel">
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
  height: 292px;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--border-0);
  background: var(--bg-1);
  flex: 0 0 auto;
}
.transport {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 38px;
  padding: 0 10px;
  border-bottom: 1px solid var(--border-0);
  flex: 0 0 auto;
}
.tp-left,
.tp-right {
  display: flex;
  align-items: center;
  gap: 6px;
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
</style>

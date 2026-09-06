<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import type { MediaFilter } from '~/utils/ffmpegFilterGraph'
import { drawFilterFrame } from '~/utils/filterFrame'
import { renderGpuPreview, retainGpuPreview } from '~/utils/gpuFilterPreview'

const props = defineProps<{
  media?: HTMLImageElement | HTMLVideoElement
  filter: MediaFilter
  width: number
  height: number
  fit?: string
  crop?: any
  radius?: any
  time: number
  playing: boolean
  visible: boolean
  animated?: boolean
}>()
const canvas = ref<HTMLCanvasElement>()
const ready = ref(false)
const error = ref(false)
const revision = ref(0)
const mode = ref<'gpu' | 'ffmpeg'>('gpu')
const exactPending = ref(true)
const gpuUnavailable = ref(false)
const shape = computed(() =>
  JSON.stringify([
    props.filter,
    props.width,
    props.height,
    props.fit,
    props.crop,
    props.radius,
  ])
)
let alive = true
let generation = 0
let pending = false
let dirty = true
let raf = 0
let paintedTime = -1
let refineAt = 0
let retryGpuAt = 0
let releaseGpu: (() => void) | undefined
let callbackVideo: HTMLVideoElement | undefined
let frameCallback = 0
let release: (() => void) | undefined
let engine: typeof import('~/utils/ffmpegPreview') | undefined
const scratch = typeof document !== 'undefined' ? document.createElement('canvas') : null

function invalidate() {
  generation++
  dirty = true
  error.value = false
  exactPending.value = !props.playing
  // Show GPU feedback immediately, refine only after the edit/seek settles.
  refineAt = performance.now() + 150
}
watch(
  [shape, () => props.media],
  () => {
    invalidate()
  },
  { flush: 'post' }
)
watch(
  () => props.time,
  () => {
    // Playback takes the latest decoded frame. Paused seeks must invalidate any
    // old result immediately, including seeking backwards to the same timestamp.
    if (!props.playing && props.media instanceof HTMLVideoElement) {
      invalidate()
    }
  }
)
watch(
  () => props.playing,
  () => {
    invalidate()
  }
)

function bindVideoFrames() {
  if (callbackVideo && frameCallback)
    callbackVideo.cancelVideoFrameCallback(frameCallback)
  callbackVideo = props.media instanceof HTMLVideoElement ? props.media : undefined
  frameCallback = 0
  const video = callbackVideo
  if (!video?.requestVideoFrameCallback) return
  const frame = () => {
    if (!alive || callbackVideo !== video) return
    if (props.playing) dirty = true
    else if (Math.abs(paintedTime - video.currentTime) > 0.001) invalidate()
    frameCallback = video.requestVideoFrameCallback(frame)
  }
  frameCallback = video.requestVideoFrameCallback(frame)
}
watch(() => props.media, bindVideoFrames, { flush: 'post' })

function paint() {
  const media = props.media
  if (!alive || !props.visible || !media || !canvas.value || !scratch) return
  // v-show scene layers can be hidden while their local timeline is visible.
  if (!canvas.value.getClientRects().length) return
  const video = media instanceof HTMLVideoElement ? media : null
  if (
    video
      ? video.readyState < 2 || video.seeking
      : !(media as HTMLImageElement).complete || !(media as HTMLImageElement).naturalWidth
  )
    return
  const time = video?.currentTime ?? props.time
  const width = Math.max(1, Math.round(props.width))
  const height = Math.max(1, Math.round(props.height))
  const newFrame =
    dirty ||
    !ready.value ||
    (props.animated && props.playing) ||
    (video && !video.requestVideoFrameCallback && paintedTime !== time)
  if (newFrame && performance.now() >= retryGpuAt) {
    try {
      const output = renderGpuPreview(media, width, height, props.filter, {
        fit: props.fit,
        crop: props.crop,
        radius: props.radius,
      })
      if (canvas.value.width !== width || canvas.value.height !== height) {
        canvas.value.width = width
        canvas.value.height = height
      }
      const ctx = canvas.value.getContext('2d')!
      ctx.clearRect(0, 0, width, height)
      ctx.drawImage(output, 0, 0)
      mode.value = 'gpu'
      ready.value = true
      gpuUnavailable.value = false
      revision.value++
      paintedTime = time
      dirty = false
    } catch {
      gpuUnavailable.value = true
      retryGpuAt = performance.now() + 2000
    }
  }
  // A GPU frame never waits for a WASM job. Paused/still frames settle to the
  // reference engine; browsers without GPU support keep the compatible path.
  if (
    !pending &&
    !error.value &&
    ((!props.playing && exactPending.value && performance.now() >= refineAt) ||
      (props.playing && gpuUnavailable.value && newFrame))
  )
    void refine(media, width, height, time)
}

async function refine(
  media: HTMLImageElement | HTMLVideoElement,
  width: number,
  height: number,
  time: number
) {
  if (!scratch) return
  pending = true
  const ticket = generation
  const compatiblePlayback = props.playing
  const filter = { ...props.filter }
  try {
    if (!engine) {
      engine = await import('~/utils/ffmpegPreview')
      if (!alive) return
      release = engine.retainFilterEngine()
    }
    if (!alive || ticket !== generation) return
    if (width * height > 4096 * 4096) throw new Error('Filter frame is too large')
    if (scratch.width !== width || scratch.height !== height) {
      scratch.width = width
      scratch.height = height
    }
    const ctx = scratch.getContext('2d', { willReadFrequently: true })!
    drawFilterFrame(ctx, media, width, height, props.fit, props.crop, props.radius)
    const input = ctx.getImageData(0, 0, width, height)
    const output = await engine.filterRgba(
      new Uint8Array(input.data.buffer),
      width,
      height,
      filter,
      () =>
        alive && ticket === generation && (!compatiblePlayback || gpuUnavailable.value)
    )
    if (
      !output ||
      !alive ||
      ticket !== generation ||
      !canvas.value ||
      (compatiblePlayback && !gpuUnavailable.value)
    )
      return
    if (canvas.value.width !== width || canvas.value.height !== height) {
      canvas.value.width = width
      canvas.value.height = height
    }
    canvas.value
      .getContext('2d')!
      .putImageData(new ImageData(new Uint8ClampedArray(output), width, height), 0, 0)
    ready.value = true
    exactPending.value = false
    mode.value = 'ffmpeg'
    revision.value++
    paintedTime = time
    dirty = false
  } catch {
    if (alive && ticket === generation) error.value = true
  } finally {
    pending = false
  }
}

onMounted(() => {
  releaseGpu = retainGpuPreview()
  bindVideoFrames()
  const tick = () => {
    void paint()
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
})
onBeforeUnmount(() => {
  alive = false
  generation++
  cancelAnimationFrame(raf)
  release?.()
  releaseGpu?.()
  if (callbackVideo && frameCallback)
    callbackVideo.cancelVideoFrameCallback(frameCallback)
  if (scratch) {
    scratch.width = 0
    scratch.height = 0
  }
})
</script>

<template>
  <div
    class="filtered-media"
    :data-filter-state="error ? 'error' : ready && !exactPending ? 'ready' : 'loading'"
    :data-filter-revision="revision"
    :data-filter-engine="mode"
    :data-filter-gpu-unavailable="gpuUnavailable || undefined"
  >
    <canvas
      ref="canvas"
      :style="{ visibility: ready ? 'visible' : 'hidden' }"
      aria-label="Filtered media preview"
    />
    <div
      v-if="error || !ready"
      class="filter-status"
      :class="{ compact: ready }"
      role="status"
    >
      <template v-if="error">
        <span>Filter preview unavailable</span>
        <button type="button" @click.stop="invalidate">Retry</button>
      </template>
      <span v-else>Preparing filters…</span>
    </div>
    <span v-else-if="gpuUnavailable && playing" class="compatibility-note">
      Compatibility preview — GPU unavailable
    </span>
  </div>
</template>

<style scoped>
.filtered-media,
canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.filter-status {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: var(--bg-2);
  color: var(--text-2);
  font-size: 11px;
}
button {
  pointer-events: auto;
}
.filter-status.compact,
.compatibility-note {
  position: absolute;
  inset: auto 4px 4px auto;
  padding: 4px 6px;
  border-radius: 4px;
  background: var(--bg-2);
  color: var(--text-2);
  font-size: 10px;
}
</style>

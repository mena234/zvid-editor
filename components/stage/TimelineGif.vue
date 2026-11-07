<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { gifFrameIndexAt, openTimelineGif, type TimelineGif } from '~/utils/gifTimeline'

const props = defineProps<{ src: string; time: number; fps: number; roundToFrame: boolean }>()
const emit = defineEmits<{
  frame: [canvas: HTMLCanvasElement]
  fallback: []
}>()
const canvas = ref<HTMLCanvasElement>()
const state = ref<'loading' | 'ready'>('loading')
const frameIndex = ref(-1)
let gif: TimelineGif | undefined
let controller: AbortController | undefined
let generation = 0
let pending = false
let desired = 0

async function paint() {
  const source = gif
  if (!source || !canvas.value) return
  desired = gifFrameIndexAt(source.frames, props.time, props.fps, source.repetitions, props.roundToFrame)
  if (frameIndex.value === desired) { state.value = 'ready'; return }
  state.value = 'loading'
  if (pending) return
  pending = true
  const ticket = generation
  try {
    while (ticket === generation) {
      const index = desired
      const { image } = await source.decode(index)
      try {
        if (ticket !== generation || !canvas.value) return
        // A later seek wins, even when an earlier asynchronous decode finishes.
        if (index === desired) {
          const target = canvas.value
          if (target.width !== image.displayWidth) target.width = image.displayWidth
          if (target.height !== image.displayHeight) target.height = image.displayHeight
          const context = target.getContext('2d')!
          context.clearRect(0, 0, target.width, target.height)
          context.drawImage(image, 0, 0)
          frameIndex.value = index
          state.value = 'ready'
          emit('frame', target)
        }
      } finally {
        image.close()
      }
      if (frameIndex.value === desired) break
    }
  } catch {
    if (ticket === generation) emit('fallback')
  } finally {
    if (ticket === generation) pending = false
  }
}

async function load() {
  const ticket = ++generation
  controller?.abort()
  gif?.close()
  gif = undefined
  pending = false
  frameIndex.value = -1
  state.value = 'loading'
  controller = new AbortController()
  try {
    const source = await openTimelineGif(props.src, controller.signal)
    if (ticket !== generation) { source.close(); return }
    gif = source
    await paint()
  } catch {
    // Preserve the existing browser image preview when ImageDecoder is absent
    // or rejects a source; never leave an unsupported browser on a blank frame.
    if (ticket === generation) emit('fallback')
  }
}

watch(() => props.src, load)
watch([() => props.time, () => props.fps, () => props.roundToFrame], paint)
onMounted(load)
onBeforeUnmount(() => {
  generation++
  controller?.abort()
  gif?.close()
})
</script>

<template>
  <canvas ref="canvas" class="media timeline-gif" :data-gif-state="state" :data-gif-frame="frameIndex" />
</template>

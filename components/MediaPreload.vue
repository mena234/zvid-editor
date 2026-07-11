<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useProjectStore } from '~/stores/project'
import { canonicalVisualType } from '~/shared/schema/types'
import { stageMediaReady } from '~/composables/usePlayback'

/**
 * Invisible media warmer: buffers upcoming media (later scenes, later
 * timeline items) starting the moment the project loads — not when the
 * playhead first reaches them. The stage elements that later need the same
 * URL are then served from the browser cache.
 *
 * What it deliberately does NOT load:
 * - videos visible at the start of the timeline — their stage elements
 *   already fetch at full priority; a duplicate fetch would halve the
 *   bandwidth of exactly the file the user is waiting on
 * - audio — AudioEngine creates preload=auto elements for every audio in
 *   the playback scope at mount
 *
 * The queue is ordered by when each file is first needed, runs a limited
 * number of downloads at once, and stays completely idle until the media
 * visible on the stage can render (5s fallback) — the first frame gets the
 * whole pipe.
 */
const project = useProjectStore()

interface Entry {
  kind: 'video' | 'image'
  src: string
  /** approximate timeline second this file is first needed at (sort key) */
  at: number
}

const CONCURRENCY = 3
/** a stalled/slow file must not block the rest of the queue forever */
const STALL_MS = 20_000
/** longest the queue waits for the visible stage media before starting */
const HOLD_MS = 5_000
/** entries needed this early are the stage's own job (its elements are
 *  mounted, visible and fetching at full priority) */
const STAGE_OWNED_S = 0.25

const entries = computed<Entry[]>(() => {
  // resolvedPreviewDoc falls back to the raw doc when the variables preview
  // is off; srcs still holding {{placeholders}} aren't fetchable — skip them
  const doc = project.resolvedPreviewDoc
  const best = new Map<string, Entry>()
  const add = (kind: Entry['kind'], src: unknown, at: number) => {
    if (typeof src !== 'string' || !src || src.includes('{{')) return
    const key = `${kind}:${src}`
    const cur = best.get(key)
    if (!cur || at < cur.at) best.set(key, { kind, src, at })
  }
  const addVisuals = (items: Record<string, any>[] | undefined, base: number) => {
    for (const v of items ?? []) {
      const t = canonicalVisualType(v.type)
      const at = base + (typeof v.enterBegin === 'number' ? v.enterBegin : 0)
      if (t === 'VIDEO') add('video', v.src, at)
      else if (t === 'IMAGE' || t === 'GIF') add('image', v.src, at)
    }
  }
  addVisuals(doc.visuals, 0)
  let sceneStart = 0
  for (const scene of doc.scenes ?? []) {
    addVisuals(scene.visuals, sceneStart)
    sceneStart += typeof scene.duration === 'number' ? scene.duration : 5
  }
  return [...best.values()]
    .filter((e) => !(e.kind === 'video' && e.at <= STAGE_OWNED_S))
    .sort((a, b) => a.at - b.at)
})

const host = ref<HTMLElement>()
/** key -> element, for everything started (loading or done) */
const elements = new Map<string, HTMLElement>()
let queue: Entry[] = []
let inFlight = 0
let released = false
let holdTimer: ReturnType<typeof setTimeout> | undefined

function startOne(e: Entry) {
  const key = `${e.kind}:${e.src}`
  inFlight++
  let settled = false
  const done = () => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    inFlight--
    pump()
  }
  const timer = setTimeout(done, STALL_MS)

  // no crossorigin on any of these: the request mode must match the stage
  // elements' plain loads for the cache entries to be reusable (and
  // CORS-mode loads fail outright on hosts without ACAO headers)
  let el: HTMLElement
  if (e.kind === 'image') {
    const img = new Image()
    img.fetchPriority = 'low'
    img.onload = done
    img.onerror = done
    img.src = e.src
    el = img
  } else {
    const media = document.createElement('video')
    media.preload = 'auto'
    media.muted = true
    media.addEventListener('canplaythrough', done, { once: true })
    media.addEventListener('error', done, { once: true })
    media.src = e.src
    el = media
  }
  elements.set(key, el)
  // keep it in the DOM so its buffer stays alive for the session
  host.value?.append(el)
}

function pump() {
  if (!released) return
  while (inFlight < CONCURRENCY && queue.length) startOne(queue.shift()!)
}

/** stay idle until the media visible on the stage can render — the first
 *  frame must never share bandwidth with background warming */
function releaseWhenStageReady() {
  released = false
  clearTimeout(holdTimer)
  const deadline = Date.now() + HOLD_MS
  const check = () => {
    if (stageMediaReady() || Date.now() >= deadline) {
      released = true
      pump()
    } else {
      holdTimer = setTimeout(check, 250)
    }
  }
  check()
}

function detach(el: HTMLElement) {
  if (el instanceof HTMLMediaElement) el.src = '' // abort any pending fetch
  el.remove()
}

function rebuild(list: Entry[]) {
  const want = new Set(list.map((e) => `${e.kind}:${e.src}`))
  for (const [key, el] of elements) {
    if (!want.has(key)) {
      detach(el)
      elements.delete(key)
    }
  }
  queue = list.filter((e) => !elements.has(`${e.kind}:${e.src}`))
  releaseWhenStageReady()
}

onMounted(() => watch(entries, rebuild, { immediate: true }))
onBeforeUnmount(() => {
  clearTimeout(holdTimer)
  queue = []
  for (const el of elements.values()) detach(el)
  elements.clear()
})
</script>

<template>
  <!-- display:none does not stop media elements or images from loading -->
  <div ref="host" class="media-preload" aria-hidden="true" />
</template>

<style scoped>
.media-preload {
  display: none;
}
</style>

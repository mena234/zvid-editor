<script setup lang="ts">
import { computed, watch, onBeforeUnmount } from 'vue'
import { useEditorContext } from '~/composables/useEditorContext'
import { resolveAudioTiming } from '~/shared/schema/defaults'
import { useMediaProbe } from '~/composables/useMediaProbe'
import { clamp } from '~/utils/time'
import type { AudioDoc } from '~/shared/schema/types'

/**
 * Invisible audio playback engine (M5): one HTMLAudioElement per audio item,
 * honoring enter/exit windows, source trim, volume, speed and auto-loop.
 * Video items' own audio plays through their stage <video> elements.
 */
const { project, editor, contextAudios, contextDuration, scenePlan } =
  useEditorContext()
const { probe } = useMediaProbe()

interface ActiveAudio {
  doc: AudioDoc
  /** timeline offset of the owning scene (0 in flat/scene-local mode) */
  offset: number
  contextDuration: number
}

const isFullPreview = computed(
  () =>
    !!project.doc.scenes?.length &&
    editor.context === 'root' &&
    editor.scenePreviewMode === 'full'
)

const audioSet = computed<ActiveAudio[]>(() => {
  if (isFullPreview.value && scenePlan.value) {
    const out: ActiveAudio[] = []
    for (const entry of scenePlan.value.entries) {
      for (const a of entry.scene.audios)
        out.push({ doc: a, offset: entry.start, contextDuration: entry.duration })
    }
    for (const a of project.doc.audios)
      out.push({ doc: a, offset: 0, contextDuration: contextDuration.value })
    return out
  }
  return contextAudios.value.map((a) => ({
    doc: a,
    offset: 0,
    contextDuration: contextDuration.value,
  }))
})

const elements = new Map<string, HTMLAudioElement>()

function elementFor(doc: AudioDoc): HTMLAudioElement {
  let el = elements.get(doc._id)
  if (!el) {
    el = new Audio()
    el.preload = 'auto'
    el.crossOrigin = 'anonymous'
    el.src = doc.src
    elements.set(doc._id, el)
  } else if (el.dataset.src !== doc.src) {
    el.src = doc.src
  }
  el.dataset.src = doc.src
  return el
}

function sync() {
  const t = editor.playhead
  const seen = new Set<string>()

  for (const { doc, offset, contextDuration: ctxDur } of audioSet.value) {
    if (!doc.src) continue
    seen.add(doc._id)
    const el = elementFor(doc)
    const probed = probe('audio', doc.src)
    const timing = resolveAudioTiming(doc, ctxDur, probed.duration)
    const local = t - offset - timing.enter
    const windowDur = timing.exit - timing.enter
    const active = editor.playing && local >= 0 && local < windowDur

    const vol = clamp(timing.volume, 0, 1)
    el.volume = vol
    el.muted = editor.muted || vol === 0
    el.playbackRate = clamp(timing.speed * editor.playbackRate, 0.25, 4)

    if (active) {
      const trimmed = Math.max(0.05, timing.audioEnd - timing.audioBegin)
      const srcT = timing.audioBegin + ((local * timing.speed) % trimmed)
      if (Math.abs(el.currentTime - srcT) > 0.3) {
        try {
          el.currentTime = srcT
        } catch {
          /* metadata not ready yet */
        }
      }
      if (el.paused) el.play().catch(() => {})
    } else if (!el.paused) {
      el.pause()
    }
  }

  // pause & drop elements for removed items
  for (const [id, el] of elements) {
    if (!seen.has(id)) {
      el.pause()
      el.src = ''
      elements.delete(id)
    }
  }
}

watch(
  [
    () => editor.playhead,
    () => editor.playing,
    () => editor.muted,
    () => editor.playbackRate,
    audioSet,
  ],
  sync,
  { deep: false }
)

onBeforeUnmount(() => {
  for (const el of elements.values()) {
    el.pause()
    el.src = ''
  }
  elements.clear()
})
</script>

<template>
  <span hidden />
</template>

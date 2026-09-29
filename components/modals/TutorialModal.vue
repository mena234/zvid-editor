<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useEditorStore } from '~/stores/editor'
import { EDITOR_TUTORIAL as tutorial, EDITOR_TUTORIAL_URL } from '~/utils/editorTutorial'

const editor = useEditorStore()
const startAt = ref<number | null>(null)
const playerKey = ref(0)
const playerLoading = ref(false)
const playerContainer = ref<HTMLElement | null>(null)
const watchUrl = computed(() => startAt.value === null ? EDITOR_TUTORIAL_URL : `${EDITOR_TUTORIAL_URL}&t=${startAt.value}s`)
const playerUrl = computed(() => {
  if (startAt.value === null) return null
  return `https://www.youtube-nocookie.com/embed/${tutorial.videoId}?autoplay=1&playsinline=1&rel=0&start=${startAt.value}`
})

async function play(seconds = 0) {
  const replacingFocusedPoster = document.activeElement?.classList.contains('tutorial-poster')
  startAt.value = seconds
  playerLoading.value = true
  // Re-selecting a chapter also restarts it. Unmounting the dialog stops playback.
  playerKey.value++
  // Keep keyboard focus inside the dialog when its play button disappears.
  if (replacingFocusedPoster) {
    await nextTick()
    playerContainer.value?.focus()
  }
}
</script>

<template>
  <UiModal title="Learn the editor" width="1120px" @close="editor.closeModal()">
    <div class="tutorial-intro">
      <h3>{{ tutorial.title }}</h3>
      <p>Follow along from a blank canvas to a reusable product video. {{ tutorial.duration }} · Step-by-step guide</p>
    </div>
    <div class="tutorial-layout">
      <div class="tutorial-main">
        <div ref="playerContainer" class="tutorial-player" tabindex="-1">
          <iframe
            v-if="playerUrl"
            :key="playerKey"
            :src="playerUrl"
            title="Zvid editor tutorial: Build a Product Hero"
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
            allowfullscreen
            referrerpolicy="strict-origin-when-cross-origin"
            tabindex="0"
            @load="playerLoading = false"
          />
          <div v-if="playerUrl && playerLoading" class="tutorial-loading" role="status">
            <span>Loading tutorial…</span>
            <a :href="watchUrl" target="_blank" rel="noopener noreferrer">Watch on YouTube</a>
          </div>
          <button v-if="!playerUrl" class="tutorial-poster" aria-label="Play the Product Hero tutorial" @click="play()">
            <img :src="tutorial.poster" alt="Product video from scratch with Zvid" width="1280" height="720" />
            <span class="tutorial-play"><UiIcon name="play" :size="22" /> Watch tutorial</span>
          </button>
        </div>
        <p class="tutorial-note">Your project stays open while you watch. Choose a topic to jump to that part of the video.</p>
        <div class="tutorial-links">
          <a :href="watchUrl" target="_blank" rel="noopener noreferrer">Watch on YouTube <UiIcon name="link" :size="14" /></a>
          <a href="https://docs.zvid.io" target="_blank" rel="noopener noreferrer">Read the docs <UiIcon name="link" :size="14" /></a>
        </div>
      </div>
      <nav class="tutorial-chapters" aria-label="Tutorial chapters">
        <h4>Jump to a topic</h4>
        <button
          v-for="chapter in tutorial.chapters"
          :key="chapter.seconds"
          class="tutorial-chapter"
          :aria-pressed="startAt === chapter.seconds"
          @click="play(chapter.seconds)"
        >
          <span class="chapter-time">{{ chapter.time }}</span>
          <span>{{ chapter.title }}</span>
        </button>
      </nav>
    </div>
  </UiModal>
</template>

<style scoped>
.tutorial-intro { margin-bottom: 18px; }
.tutorial-intro h3 { margin: 0 0 7px; font-size: 22px; letter-spacing: -0.025em; }
.tutorial-intro p, .tutorial-note { margin: 0; color: var(--text-1); line-height: 1.6; }
.tutorial-layout { display: grid; grid-template-columns: minmax(0, 1fr) 290px; gap: 24px; align-items: start; }
.tutorial-main { min-width: 0; }
.tutorial-player { position: relative; width: 100%; aspect-ratio: 16 / 9; min-height: 200px; overflow: hidden; border-radius: var(--radius-m); background: #0e0d14; }
.tutorial-loading { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; color: #f1f0f7; background: #0e0d14; }
.tutorial-loading a { color: #c4b5fd; text-underline-offset: 3px; }
.tutorial-player iframe, .tutorial-poster { display: block; width: 100%; height: 100%; border: 0; }
.tutorial-poster { position: relative; padding: 0; background: transparent; color: #fff; }
.tutorial-poster img { display: block; width: 100%; height: 100%; object-fit: contain; }
.tutorial-play { position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 9px; padding: 12px 18px; border-radius: 999px; background: #7c3aed; color: #fff; font-size: 14px; font-weight: 600; white-space: nowrap; box-shadow: 0 4px 20px #0008; }
.tutorial-poster:hover .tutorial-play { background: #6528d0; }
.tutorial-poster:focus-visible { outline: 3px solid var(--accent-strong); outline-offset: -4px; }
.tutorial-note { margin-top: 14px; font-size: 12px; }
.tutorial-links { display: flex; flex-wrap: wrap; gap: 8px 20px; margin-top: 10px; }
.tutorial-links a { display: inline-flex; align-items: center; gap: 5px; color: var(--accent-strong); min-height: 32px; text-underline-offset: 3px; }
.tutorial-chapters h4 { margin: 0 0 8px; font-size: 13px; }
.tutorial-chapter { display: flex; align-items: baseline; gap: 10px; width: 100%; min-height: 40px; padding: 10px 8px; text-align: left; color: var(--text-1); font-size: 12px; line-height: 1.45; border: 0; border-radius: var(--radius-s); background: transparent; }
.tutorial-chapter:hover { background: var(--bg-2); color: var(--text-0); }
.tutorial-chapter[aria-pressed='true'] { color: var(--accent-strong); background: var(--accent-soft); }
.chapter-time { flex: 0 0 34px; font-variant-numeric: tabular-nums; font-family: var(--font-mono); font-size: 11px; }
@media (max-width: 850px) {
  .tutorial-layout { grid-template-columns: minmax(0, 1fr); gap: 20px; }
  .tutorial-chapter { min-height: 44px; font-size: 13px; }
}
@media (max-width: 600px) {
  .tutorial-intro h3 { font-size: 20px; }
  .tutorial-intro { margin-bottom: 14px; }
  .tutorial-play { bottom: 12px; padding: 10px 14px; font-size: 13px; }
}
</style>

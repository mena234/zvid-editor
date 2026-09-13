<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useEditorContext } from '~/composables/useEditorContext'
import { searchSoundEffects, type SoundEffect } from '~/utils/soundEffects'
import { mediaEndAtPlayhead } from '~/utils/stockDrag'

const { project, editor, contextDuration } = useEditorContext()
const query = ref('')
const items = computed(() => searchSoundEffects(query.value))
const playingId = ref<string | null>(null)
let audio: HTMLAudioElement | null = null

function stopPreview() {
  if (audio) {
    audio.pause()
    audio.src = ''
    audio = null
  }
  playingId.value = null
}

function togglePreview(effect: SoundEffect) {
  const wasPlaying = playingId.value === effect.id
  stopPreview()
  if (wasPlaying) return
  const player = new Audio(effect.path)
  audio = player
  playingId.value = effect.id
  player.addEventListener('ended', () => {
    if (audio === player) stopPreview()
  })
  void player.play().catch(() => {
    if (audio !== player) return
    stopPreview()
    editor.notify('Could not play this sound effect', 'error')
  })
}

function addEffect(effect: SoundEffect) {
  const exit = mediaEndAtPlayhead(editor.playhead, effect.duration)!
  const origin = import.meta.dev ? window.location.origin : 'https://editor.zvid.io'
  const added = project.addAudio(editor.context, {
    // Absolute URLs also work when the project is rendered outside the editor.
    src: new URL(effect.path, origin).href,
    audioEnd: effect.duration,
    exit,
  }, { extendDurationTo: exit, currentDuration: contextDuration.value })
  editor.selectAudio(added._id)
  editor.notify(`${effect.name} added to the timeline`, 'success')
}

onBeforeUnmount(stopPreview)
</script>

<template>
  <section class="sound-effects-panel" aria-label="Sound effects library">
    <h3 class="title">Sound effects</h3>
    <div class="searchbar">
      <UiIcon name="zoom" :size="14" />
      <input v-model="query" type="search" aria-label="Search sound effects" placeholder="Search sound effects…" />
    </div>
    <p v-if="!items.length" class="hint">No sound effects found — try another search term.</p>
    <div class="audio-list">
      <div v-for="effect in items" :key="effect.id" class="audio-row">
        <button
          class="play"
          :title="`${playingId === effect.id ? 'Pause' : 'Play'} ${effect.name} preview`"
          :aria-label="`${playingId === effect.id ? 'Pause' : 'Play'} ${effect.name} preview`"
          @click="togglePreview(effect)"
        ><UiIcon :name="playingId === effect.id ? 'pause' : 'play'" :size="13" /></button>
        <button class="add-effect" :title="`Add ${effect.name} at the playhead`" @click="addEffect(effect)">
          <span class="name">{{ effect.name }}</span>
          <span class="duration">{{ effect.duration.toFixed(1) }}s</span>
        </button>
      </div>
    </div>
    <p class="hint library-note">Original sounds from Zvid's stock library · click to add at the playhead</p>
  </section>
</template>

<style scoped>
.sound-effects-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.title {
  margin: 0;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-1);
  text-transform: uppercase;
  letter-spacing: 0.4px;
}
.searchbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-m);
  background: var(--bg-2);
  color: var(--text-3);
}
.searchbar:focus-within {
  border-color: var(--accent);
}
.searchbar input {
  flex: 1;
  min-width: 0;
  padding: 7px 0;
  border: none;
  background: none;
  color: var(--text-0);
  font-size: 11.5px;
  outline: none;
}
.audio-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.audio-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px 7px 8px;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-m);
  background: var(--bg-2);
}
.audio-row:hover {
  border-color: var(--accent);
}
.play {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--border-1);
  border-radius: 50%;
  background: var(--bg-3);
  color: var(--accent);
}
.play:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.add-effect {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  align-self: stretch;
  border: none;
  padding: 0;
  background: none;
  color: var(--text-1);
  font-size: 11px;
  text-align: left;
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.duration {
  color: var(--text-3);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
.hint {
  margin: 0;
  font-size: 10.5px;
  color: var(--text-3);
}
.library-note {
  text-align: center;
  font-size: 10px;
}
</style>

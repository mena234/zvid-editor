<script setup lang="ts">
// One media-type tab (Images / Videos / Audio / GIFs): an optional "add by
// URL" row, the user's uploads, then the stock library (Jamendo for audio,
// Pexels/Pixabay/Unsplash/Giphy for visuals).
import { ref, computed, watchEffect } from 'vue'
import { useEditorContext } from '~/composables/useEditorContext'
import { useTemplateVars } from '~/composables/useTemplateVars'
import { useMediaReplace } from '~/composables/useMediaReplace'
import { useMediaProbe } from '~/composables/useMediaProbe'
import { round3 } from '~/utils/time'
import { visualLabel } from '~/utils/visualLabel'
import type { UploadKind } from '~/stores/uploads'

const props = defineProps<{ kind: UploadKind }>()

const { project, editor, contextDuration, activeScene } = useEditorContext()
const tvars = useTemplateVars()
const { tryReplace } = useMediaReplace()
const { probe } = useMediaProbe()

/* ---------------- replace-image mode ---------------- */
const replaceTarget = computed(() =>
  props.kind === 'image' && editor.replaceTargetId
    ? project.visualById(editor.replaceTargetId)
    : undefined
)
// the armed visual disappeared (deleted / project switched) — disarm
watchEffect(() => {
  if (editor.replaceTargetId && !project.visualById(editor.replaceTargetId))
    editor.cancelReplace()
})

const VISUAL_TYPE: Record<UploadKind, 'IMAGE' | 'VIDEO' | 'GIF' | 'AUDIO'> = {
  image: 'IMAGE',
  video: 'VIDEO',
  gif: 'GIF',
  audio: 'AUDIO',
}
const EXT: Record<UploadKind, string> = {
  image: 'png',
  video: 'mp4',
  gif: 'gif',
  audio: 'mp3',
}
const label = computed(() => (props.kind === 'gif' ? 'GIF' : props.kind))

const showUrl = ref(false)
const audioCategory = ref<'music' | 'sound-effects'>('music')
const mediaUrl = ref('')
const varOptions = computed(() =>
  tvars.placeholderOptions(activeScene.value, 'string')
)

function defaultTiming() {
  const t0 = round3(Math.min(editor.playhead, Math.max(0, contextDuration.value - 1)))
  return {
    enterBegin: t0 || undefined,
    exitEnd: round3(Math.min(contextDuration.value, t0 + 5)),
  }
}

function addFromUrl() {
  const src = mediaUrl.value.trim()
  if (!src) return
  if (src.includes('{{')) {
    // Strict: unknown/mistyped placeholders never enter the document.
    const check = tvars.validateTemplateValue(src, 'string', activeScene.value)
    if (!check.ok) {
      editor.notify(check.message, 'error')
      return
    }
  }
  const type = VISUAL_TYPE[props.kind]
  if (type === 'IMAGE' && tryReplace('image', src)) {
    mediaUrl.value = ''
    showUrl.value = false
    return
  }
  if (type === 'AUDIO') {
    const added = project.addAudio(editor.context, { src }, {
      currentDuration: contextDuration.value,
      sourceDuration: src.includes('{{') ? undefined : probe('audio', src).duration,
    })
    editor.selectAudio(added._id)
  } else {
    const added = project.addVisual(editor.context, {
      type,
      src,
      position: 'center-center',
      anchor: 'center-center',
      ...(type !== 'GIF' ? { resize: 'contain' as const } : {}),
      ...defaultTiming(),
    })
    editor.selectVisual(added._id)
  }
  mediaUrl.value = ''
  showUrl.value = false
  editor.notify(`${label.value} added`, 'success')
}
</script>

<template>
  <div class="media-panel">
    <div v-if="replaceTarget" class="replace-banner">
      <UiIcon name="info" :size="14" class="replace-icon" />
      <p class="replace-text">
        Replacing <strong>{{ visualLabel(replaceTarget, 24) }}</strong> — pick a
        new image below. It keeps the old image's size, position and effects.
      </p>
      <button class="btn ghost sm" @click="editor.cancelReplace()">Cancel</button>
    </div>

    <div class="url-add">
      <button class="url-toggle" @click="showUrl = !showUrl">
        <UiIcon name="link" :size="13" />
        Add {{ label }} by URL
        <UiIcon :name="showUrl ? 'chevron_up' : 'chevron_down'" :size="13" class="chev" />
      </button>
      <form v-if="showUrl" class="url-form" @submit.prevent="addFromUrl">
        <div class="url-row">
          <input
            v-model="mediaUrl"
            class="ctl"
            type="text"
            :placeholder="`https://… .${EXT[kind]}`"
            spellcheck="false"
          />
          <UiVarMenu
            :options="varOptions"
            title="Use a variable for the URL"
            @insert="mediaUrl = $event"
          />
        </div>
        <button type="submit" class="btn primary sm" :disabled="!mediaUrl.trim()">
          Add {{ label }}
        </button>
        <p class="hint">
          The URL must stay reachable by the render machine — remote URLs are
          the automation-friendly choice.
        </p>
      </form>
    </div>

    <PanelsUploadsSection :kind="kind" />

    <hr class="divider" />
    <div v-if="kind === 'audio'" class="audio-categories" aria-label="Audio categories">
      <button
        class="category"
        :class="{ active: audioCategory === 'music' }"
        :aria-pressed="audioCategory === 'music'"
        @click="audioCategory = 'music'"
      >Music</button>
      <button
        class="category"
        :class="{ active: audioCategory === 'sound-effects' }"
        :aria-pressed="audioCategory === 'sound-effects'"
        @click="audioCategory = 'sound-effects'"
      >Sound effects</button>
    </div>
    <PanelsSoundEffectsPanel v-if="kind === 'audio' && audioCategory === 'sound-effects'" />
    <PanelsStockPanel v-else :kind="kind" />
  </div>
</template>

<style scoped>
.media-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}
.replace-banner {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  padding: 9px 10px;
  border: 1px solid var(--accent);
  border-radius: var(--radius-m);
  background: var(--accent-soft);
  font-size: 10.5px;
  color: var(--text-1);
}
.replace-icon {
  flex: 0 0 auto;
  margin-top: 1px;
  color: var(--accent);
}
.replace-text {
  flex: 1;
  margin: 0;
  line-height: 1.45;
  word-break: break-word;
}
.replace-banner .btn {
  flex: 0 0 auto;
}
.url-add {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.url-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 9px;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-m);
  background: var(--bg-2);
  color: var(--text-2);
  font-size: 10.5px;
  font-weight: 600;
}
.url-toggle:hover {
  border-color: var(--accent);
  color: var(--text-0);
}
.url-toggle .chev {
  margin-left: auto;
}
.url-form {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 10px;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-m);
  background: var(--bg-2);
}
.url-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.url-row .ctl {
  flex: 1;
  min-width: 0;
}
.divider {
  margin: 2px 0;
  border: none;
  border-top: 1px solid var(--border-0);
}
.audio-categories {
  display: flex;
  gap: 4px;
}
.category {
  flex: 1;
  padding: 7px 8px;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-m);
  background: var(--bg-2);
  color: var(--text-2);
  font-size: 11px;
  font-weight: 600;
}
.category:hover,
.category.active {
  border-color: var(--accent);
  color: var(--accent-strong);
}
.category.active {
  background: var(--accent-soft);
}
</style>

<script setup lang="ts">
// One media-type tab (Images / Videos / Audio / GIFs): an optional "add by
// URL" row, the user's uploads, then the stock library (Jamendo for audio,
// Pexels/Pixabay/Unsplash/Giphy for visuals).
import { ref, computed } from 'vue'
import { useEditorContext } from '~/composables/useEditorContext'
import { useTemplateVars } from '~/composables/useTemplateVars'
import { round3 } from '~/utils/time'
import type { UploadKind } from '~/stores/uploads'

const props = defineProps<{ kind: UploadKind }>()

const { project, editor, contextDuration, activeScene } = useEditorContext()
const tvars = useTemplateVars()

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
  if (type === 'AUDIO') {
    const added = project.addAudio(editor.context, { src })
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
    <PanelsStockPanel :kind="kind" />
  </div>
</template>

<style scoped>
.media-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
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
</style>

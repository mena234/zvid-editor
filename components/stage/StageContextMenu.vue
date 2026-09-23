<script setup lang="ts">
import { onMounted, onBeforeUnmount, computed, ref, nextTick } from 'vue'
import { useProjectStore } from '~/stores/project'
import { useEditorStore } from '~/stores/editor'
import { canonicalVisualType } from '~/shared/schema/types'
import { resolveVisualTiming, resolveAudioTiming } from '~/shared/schema/defaults'
import { useEditorContext } from '~/composables/useEditorContext'

const props = withDefaults(
  defineProps<{ x: number; y: number; itemId: string; kind?: 'visual' | 'audio' }>(),
  { kind: 'visual' }
)
const emit = defineEmits<{ close: [] }>()

const project = useProjectStore()
const editor = useEditorStore()
const { contextDuration } = useEditorContext()
const menuEl = ref<HTMLElement>()
const position = ref({ x: 8, y: 8 })
let resizeObserver: ResizeObserver | null = null
function placeMenu() {
  const box = menuEl.value?.getBoundingClientRect()
  if (!box) return
  position.value = {
    x: Math.max(8, Math.min(props.x, window.innerWidth - box.width - 8)),
    y: Math.max(8, Math.min(props.y, window.innerHeight - box.height - 8)),
  }
}

const isAudio = computed(() => props.kind === 'audio')
const item = computed(() =>
  isAudio.value ? project.audioById(props.itemId) : project.visualById(props.itemId)
)
const type = computed(() =>
  !item.value || isAudio.value ? null : canonicalVisualType((item.value as any).type)
)

function onDocDown(e: MouseEvent) {
  if (!(e.target as HTMLElement).closest('.ctx-menu')) emit('close')
}
onMounted(() => {
  document.addEventListener('pointerdown', onDocDown, true)
  document.addEventListener('keydown', onEsc)
  resizeObserver = new ResizeObserver(placeMenu)
  if (menuEl.value) resizeObserver.observe(menuEl.value)
  nextTick(placeMenu)
  window.addEventListener('resize', placeMenu)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocDown, true)
  document.removeEventListener('keydown', onEsc)
  resizeObserver?.disconnect()
  window.removeEventListener('resize', placeMenu)
})
function onEsc(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

function run(action: () => void) {
  action()
  emit('close')
}

function duplicate() {
  if (isAudio.value) {
    const copy = project.duplicateAudio(props.itemId)
    if (copy) editor.selectAudio(copy._id)
  } else {
    const copy = project.duplicateVisual(props.itemId)
    if (copy) editor.selectVisual(copy._id)
  }
  editor.openInspector()
}
function remove() {
  if (isAudio.value) project.removeAudio(props.itemId)
  else project.removeVisual(props.itemId)
  editor.clearSelection()
}
async function copyJson() {
  if (!item.value) return
  const { _id, ...raw } = item.value
  await navigator.clipboard.writeText(JSON.stringify(raw, null, 2))
  editor.notify('Element JSON copied', 'success')
}
async function pasteJson() {
  try {
    const text = await navigator.clipboard.readText()
    const raw = JSON.parse(text)
    if (!raw || typeof raw !== 'object') throw new Error('not an element')
    if (raw.type) {
      const added = project.addVisual(editor.context, raw)
      editor.selectVisual(added._id)
    } else if (raw.src) {
      // audio items have no type field — a bare { src, … } is an audio
      const added = project.addAudio(editor.context, raw)
      editor.selectAudio(added._id)
    } else {
      throw new Error('not an element')
    }
    editor.notify('Element pasted', 'success')
  } catch {
    editor.notify('Clipboard does not contain a valid element JSON', 'error')
  }
}
function fit(mode: 'cover' | 'contain') {
  project.patchVisual(props.itemId, {
    resize: mode,
    width: undefined,
    height: undefined,
    position: 'center-center',
    anchor: 'center-center',
  })
}
function resetSize() {
  project.patchVisual(props.itemId, { width: undefined, height: undefined, resize: undefined })
}

const canSplit = computed(() => {
  if (!item.value || project.isImage) return false
  const timing = isAudio.value
    ? resolveAudioTiming(item.value as any, contextDuration.value)
    : resolveVisualTiming(item.value as any, contextDuration.value)
  const start = 'enter' in timing ? timing.enter : timing.enterBegin
  const end = 'exit' in timing ? timing.exit : timing.exitEnd
  return editor.playhead > start + 0.01 && editor.playhead < end - 0.01
})
function split() {
  if (isAudio.value) project.splitAudioAt(props.itemId, editor.playhead)
  else project.splitVisualAt(props.itemId, editor.playhead)
}

const style = computed(() => ({
  left: `${position.value.x}px`,
  top: `${position.value.y}px`,
}))
</script>

<template>
  <Teleport to="body">
    <div ref="menuEl" class="ctx-menu" :style="style" role="menu" aria-label="Element actions">
      <button @click="run(() => editor.openInspector())">Edit properties</button>
      <button v-if="!project.isImage" :disabled="!canSplit" @click="run(split)">
        Split at playhead <kbd>S</kbd>
      </button>
      <button @click="run(duplicate)">
        <UiIcon name="copy" :size="13" /> Duplicate <kbd>Ctrl+D</kbd>
      </button>
      <template v-if="!isAudio">
        <!-- image mode: no timeline lanes — reorder the layer stack directly -->
        <template v-if="project.isImage">
          <button @click="run(() => project.moveLayer(itemId, 1))">
            <UiIcon name="chevron_up" :size="13" /> Bring forward
          </button>
          <button @click="run(() => project.moveLayer(itemId, -1))">
            <UiIcon name="chevron_down" :size="13" /> Send backward
          </button>
        </template>
        <template v-else>
          <button @click="run(() => project.bumpTrack(itemId, 1))">
            <UiIcon name="chevron_up" :size="13" /> Bring forward (track +1)
          </button>
          <button @click="run(() => project.bumpTrack(itemId, -1))">
            <UiIcon name="chevron_down" :size="13" /> Send backward (track −1)
          </button>
        </template>
      </template>
      <div class="sep" />
      <template v-if="type === 'TEXT'">
        <button @click="run(() => editor.openDesigner(itemId))">
          <UiIcon name="magic" :size="13" />
          {{ (item as any)?.designer ? 'Edit in Design Studio' : 'Open in Design Studio' }}
        </button>
        <div class="sep" />
      </template>
      <template v-if="type === 'IMAGE'">
        <button @click="run(() => editor.startReplaceImage(itemId))">
          <UiIcon name="image" :size="13" /> Replace image…
        </button>
      </template>
      <template v-if="type === 'VIDEO' || type === 'IMAGE' || type === 'GIF'">
        <button @click="run(() => fit('cover'))">Fill frame (cover)</button>
        <button @click="run(() => fit('contain'))">Fit frame (contain)</button>
        <button @click="run(resetSize)">Reset to intrinsic size</button>
        <div class="sep" />
      </template>
      <button @click="run(copyJson)"><UiIcon name="json" :size="13" /> Copy JSON</button>
      <button @click="run(pasteJson)">
        <UiIcon name="upload" :size="13" /> Paste element JSON
      </button>
      <div class="sep" />
      <button class="danger" @click="run(remove)">
        <UiIcon name="trash" :size="13" /> Delete <kbd>Del</kbd>
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.ctx-menu {
  position: fixed;
  z-index: 300;
  min-width: 210px;
  max-width: calc(100vw - 16px);
  max-height: calc(100dvh - 16px);
  overflow-y: auto;
  padding: 5px;
  background: var(--bg-1);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-m);
  box-shadow: var(--shadow-2);
  display: flex;
  flex-direction: column;
}
.ctx-menu button {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 9px;
  border: none;
  background: none;
  color: var(--text-0);
  font-size: 12px;
  border-radius: var(--radius-s);
  text-align: left;
}
.ctx-menu button:hover {
  background: var(--bg-3);
}
.ctx-menu button:disabled {
  opacity: 0.45;
  cursor: default;
}
@media (pointer: coarse) {
  .ctx-menu button { min-height: 40px; }
}
.ctx-menu button.danger:hover {
  background: color-mix(in srgb, var(--red) 12%, transparent);
  color: var(--red);
}
.ctx-menu kbd {
  margin-left: auto;
}
.sep {
  height: 1px;
  background: var(--border-0);
  margin: 4px 6px;
}
</style>

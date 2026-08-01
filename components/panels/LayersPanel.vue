<script setup lang="ts">
// Image-mode layer stack: everything in an image project is "always on", so
// this panel is the structural view the timeline provides for videos —
// front-most layer first, reorder by drag or arrows, swap image sources.
import { ref, computed } from 'vue'
import { useProjectStore } from '~/stores/project'
import { useEditorStore } from '~/stores/editor'
import { canonicalVisualType } from '~/shared/schema/types'
import type { VisualDoc } from '~/shared/schema/types'
import { visualLabel } from '~/utils/visualLabel'

const project = useProjectStore()
const editor = useEditorStore()

/** UI lists front-most first; the document stores bottom → top. */
const rows = computed(() => [...project.zOrderOf('root')].reverse())

function typeOf(v: VisualDoc) {
  return canonicalVisualType(v.type)
}
function iconOf(v: VisualDoc): string {
  const t = typeOf(v)
  if (t === 'TEXT') return (v as any).designer ? 'magic' : 'text'
  if (t === 'IMAGE') return 'image'
  if (t === 'GIF') return 'gif'
  if (t === 'VIDEO') return 'video'
  if (t === 'SVG') return 'svg'
  return 'code'
}
/** literal image sources get a real thumbnail; {{placeholders}} fall back to the icon */
function thumbOf(v: VisualDoc): string | null {
  const t = typeOf(v)
  if (t !== 'IMAGE' && t !== 'GIF') return null
  const src = (v as any).src
  return typeof src === 'string' && src && !src.includes('{{') ? src : null
}

function isSelected(v: VisualDoc) {
  return (
    editor.selectionKind === 'visual' &&
    (editor.selectedId === v._id || editor.selectedIds.includes(v._id))
  )
}
function select(v: VisualDoc) {
  editor.selectVisual(v._id)
}
function openProps(v: VisualDoc) {
  editor.selectVisual(v._id)
  editor.openInspector()
}
function duplicate(v: VisualDoc) {
  const copy = project.duplicateVisual(v._id)
  if (copy) editor.selectVisual(copy._id)
}
function remove(v: VisualDoc) {
  project.removeVisual(v._id)
  if (editor.selectedId === v._id) editor.clearSelection()
}
function replaceImage(v: VisualDoc) {
  editor.selectVisual(v._id)
  editor.startReplaceImage(v._id)
}

/* ---------------- reorder: arrows + drag ---------------- */
function move(v: VisualDoc, dir: 1 | -1) {
  project.moveLayer(v._id, dir)
}

const dragId = ref<string | null>(null)
const overIndex = ref(-1)

function onDragStart(e: DragEvent, v: VisualDoc) {
  dragId.value = v._id
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}
function onDragOver(e: DragEvent, index: number) {
  if (!dragId.value) return
  e.preventDefault()
  overIndex.value = index
}
function onDrop(index: number) {
  const id = dragId.value
  dragId.value = null
  overIndex.value = -1
  if (!id) return
  const ids = rows.value.map((r) => r._id)
  const from = ids.indexOf(id)
  if (from < 0 || from === index) return
  ids.splice(from, 1)
  // dropping ON a row puts the dragged layer in that row's slot
  ids.splice(from < index ? index - 1 : index, 0, id)
  project.applyLayerOrder('root', [...ids].reverse())
}
function onDragEnd() {
  dragId.value = null
  overIndex.value = -1
}
</script>

<template>
  <div class="layers-panel">
    <h3 class="title">Layers</h3>
    <p class="order-hint">Top of the list is the front of the image.</p>

    <p v-if="!rows.length" class="empty-note">
      No layers yet — add images, text, shapes or designs from the tabs on the
      left. Each element becomes a layer you can restack here.
    </p>

    <div class="rows" @dragleave.self="overIndex = -1">
      <div
        v-for="(v, i) in rows"
        :key="v._id"
        class="row"
        :class="{
          active: isSelected(v),
          dragging: dragId === v._id,
          over: overIndex === i && dragId && dragId !== v._id,
        }"
        draggable="true"
        @click="select(v)"
        @dblclick="openProps(v)"
        @dragstart="onDragStart($event, v)"
        @dragover="onDragOver($event, i)"
        @drop.prevent="onDrop(i)"
        @dragend="onDragEnd"
      >
        <UiIcon name="drag" :size="12" class="grip" />
        <span class="thumb">
          <img v-if="thumbOf(v)" :src="thumbOf(v)!" loading="lazy" alt="" />
          <UiIcon v-else :name="iconOf(v)" :size="14" />
        </span>
        <span class="row-label" :title="visualLabel(v)">{{ visualLabel(v, 28) }}</span>
        <span class="row-actions" @click.stop @dblclick.stop>
          <button
            class="icon-btn xs"
            title="Bring forward"
            :disabled="i === 0"
            @click="move(v, 1)"
          >
            <UiIcon name="chevron_up" :size="13" />
          </button>
          <button
            class="icon-btn xs"
            title="Send backward"
            :disabled="i === rows.length - 1"
            @click="move(v, -1)"
          >
            <UiIcon name="chevron_down" :size="13" />
          </button>
          <button
            v-if="typeOf(v) === 'IMAGE'"
            class="icon-btn xs"
            title="Replace image (keeps size, position and effects)"
            @click="replaceImage(v)"
          >
            <UiIcon name="image" :size="13" />
          </button>
          <button class="icon-btn xs" title="Duplicate" @click="duplicate(v)">
            <UiIcon name="copy" :size="13" />
          </button>
          <button class="icon-btn xs danger" title="Delete layer" @click="remove(v)">
            <UiIcon name="trash" :size="13" />
          </button>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.layers-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}
.title {
  margin: 0;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-1);
  text-transform: uppercase;
  letter-spacing: 0.4px;
}
.order-hint {
  margin: 0;
  font-size: 10px;
  color: var(--text-3);
}
.empty-note {
  margin: 0;
  padding: 8px 10px;
  border: 1px dashed var(--border-1);
  border-radius: var(--radius-m);
  font-size: 10.5px;
  line-height: 1.45;
  color: var(--text-3);
}
.rows {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
  min-height: 0;
}
.row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 6px;
  border: 1px solid transparent;
  border-radius: var(--radius-s);
  color: var(--text-1);
  font-size: 11px;
  cursor: pointer;
  user-select: none;
}
.row:hover {
  background: var(--bg-3);
}
.row.active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--text-0);
}
.row.dragging {
  opacity: 0.4;
}
.row.over {
  border-color: var(--accent);
}
.grip {
  flex: 0 0 auto;
  color: var(--text-3);
  cursor: grab;
}
.thumb {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 30px;
  height: 22px;
  border: 1px solid var(--border-1);
  border-radius: 3px;
  background: var(--bg-2);
  color: var(--text-2);
  overflow: hidden;
}
.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  pointer-events: none;
}
.row.active .thumb {
  color: var(--accent);
}
.row-label {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.row-actions {
  display: none;
  gap: 2px;
}
.row:hover .row-actions,
.row.active .row-actions {
  display: flex;
}
.icon-btn.danger:hover {
  color: var(--red);
}
.icon-btn:disabled {
  opacity: 0.35;
  pointer-events: none;
}
</style>

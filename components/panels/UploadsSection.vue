<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useEditorContext } from '~/composables/useEditorContext'
import { useAuthStore } from '~/stores/auth'
import { useUploadsStore, type UploadKind, type UploadItem } from '~/stores/uploads'
import { setStockDragData, buildStockVisual, type StockDragPayload } from '~/utils/stockDrag'

const props = defineProps<{ kind: UploadKind }>()

const { project, editor, contextDuration } = useEditorContext()
const auth = useAuthStore()
const uploads = useUploadsStore()

const ACCEPT: Record<UploadKind, string> = {
  image: 'image/*',
  video: 'video/*',
  audio: 'audio/*',
  gif: 'image/gif',
}
const KIND_LABEL: Record<UploadKind, string> = {
  image: 'images',
  video: 'videos',
  audio: 'audio files',
  gif: 'GIFs',
}

const fileInput = ref<HTMLInputElement>()
const items = computed(() => uploads.ofKind(props.kind))
const pending = computed(() => uploads.pendingOfKind(props.kind))

onMounted(() => void uploads.load())
// refresh after a sign-in / sign-out from anywhere in the editor
watch(
  () => auth.user?.email,
  () => {
    uploads.reset()
    void uploads.load()
  }
)

/* ---------------- upload ---------------- */
async function onFilesPicked(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  for (const file of files) {
    try {
      const item = await uploads.upload(file, props.kind)
      if (item.kind !== props.kind) {
        editor.notify(
          `${file.name} uploaded — find it under the ${KIND_LABEL[item.kind]} tab`,
          'info'
        )
      }
    } catch (err: any) {
      editor.notify(err?.message || `Failed to upload ${file.name}`, 'error')
    }
  }
}

function openSignIn() {
  editor.modal = 'auth'
}

/* ---------------- add / drag (same contract as the stock grid) ---------------- */
function payloadOf(item: UploadItem): StockDragPayload {
  return {
    kind: item.kind === 'video' ? 'VIDEO' : item.kind === 'gif' ? 'GIF' : 'IMAGE',
    src: item.url,
    width: item.width ?? undefined,
    height: item.height ?? undefined,
    duration: item.duration ?? undefined,
  }
}

function onDragStart(e: DragEvent, item: UploadItem) {
  if (item.kind === 'audio') return
  setStockDragData(e, payloadOf(item))
}

function addItem(item: UploadItem) {
  if (item.kind === 'audio') {
    const added = project.addAudio(editor.context, { src: item.url })
    editor.selectAudio(added._id)
    editor.notify(`${item.fileName} added to the timeline`, 'success')
    return
  }
  const visual = buildStockVisual(payloadOf(item), {
    playhead: editor.playhead,
    contextDuration: contextDuration.value,
    projectWidth: project.defaults.width,
    projectHeight: project.defaults.height,
  })
  const added = project.addVisual(editor.context, visual)
  editor.selectVisual(added._id)
  editor.notify(
    `${item.fileName} added — drop on the canvas to place precisely`,
    'success'
  )
}

async function removeItem(item: UploadItem) {
  if (!window.confirm(`Delete "${item.fileName}" from your uploads? Projects already using it keep working until the file is gone.`))
    return
  try {
    await uploads.remove(item.id)
    editor.notify(`${item.fileName} deleted`, 'info')
  } catch (err: any) {
    editor.notify(err?.message || 'Delete failed', 'error')
  }
}

function fmtDuration(s?: number | null) {
  if (!s) return ''
  const m = Math.floor(s / 60)
  const ss = Math.round(s % 60)
  return `${m}:${String(ss).padStart(2, '0')}`
}
</script>

<template>
  <section class="uploads-section">
    <div class="head">
      <h3 class="title">Your uploads</h3>
      <button
        v-if="!uploads.authRequired"
        class="upload-btn"
        :disabled="uploads.loading"
        @click="fileInput?.click()"
      >
        <UiIcon name="upload" :size="13" />
        Upload
      </button>
    </div>
    <input
      ref="fileInput"
      type="file"
      class="hidden-input"
      :accept="ACCEPT[kind]"
      multiple
      @change="onFilesPicked"
    />

    <div v-if="uploads.authRequired" class="state-box hint">
      <p>Sign in to upload and reuse your own {{ KIND_LABEL[kind] }}.</p>
      <button class="btn ghost sm" @click="openSignIn">Sign in</button>
    </div>

    <div v-else-if="uploads.error" class="state-box error">
      <p>{{ uploads.error }}</p>
      <button class="btn ghost sm" @click="uploads.load(true)">Retry</button>
    </div>

    <template v-else>
      <p v-if="!items.length && !pending.length && uploads.items" class="empty-note">
        No uploaded {{ KIND_LABEL[kind] }} yet — they'll show up here for every project.
      </p>

      <!-- audio: row list; visuals: thumbnail grid -->
      <div v-if="kind === 'audio'" class="audio-list">
        <div v-for="p in pending" :key="p.key" class="audio-row pending">
          <span class="spinner" />
          <span class="name">{{ p.name }}</span>
        </div>
        <div
          v-for="item in items"
          :key="item.id"
          class="audio-row"
          :title="`${item.fileName} — click to add at the playhead`"
          @click="addItem(item)"
        >
          <UiIcon name="audio" :size="14" />
          <span class="name">{{ item.fileName }}</span>
          <span v-if="item.duration" class="dur">{{ fmtDuration(item.duration) }}</span>
          <button class="del" title="Delete upload" @click.stop="removeItem(item)">
            <UiIcon name="trash" :size="12" />
          </button>
        </div>
      </div>

      <div v-else-if="items.length || pending.length" class="grid" :class="{ gifs: kind === 'gif' }">
        <div v-for="p in pending" :key="p.key" class="cell skeleton" :title="`Uploading ${p.name}…`" />
        <div
          v-for="item in items"
          :key="item.id"
          class="cell"
          draggable="true"
          :title="`${item.fileName} — click to add, or drag onto the canvas`"
          @dragstart="onDragStart($event, item)"
          @click="addItem(item)"
        >
          <video
            v-if="item.kind === 'video'"
            :src="item.url"
            preload="metadata"
            muted
            playsinline
            disablepictureinpicture
          />
          <img v-else :src="item.url" loading="lazy" draggable="false" alt="" />
          <span v-if="item.duration" class="badge duration">{{ fmtDuration(item.duration) }}</span>
          <button class="del" title="Delete upload" @click.stop="removeItem(item)">
            <UiIcon name="trash" :size="12" />
          </button>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.uploads-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.title {
  margin: 0;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-1);
  text-transform: uppercase;
  letter-spacing: 0.4px;
}
.upload-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-m);
  background: var(--bg-2);
  color: var(--text-1);
  font-size: 10.5px;
  font-weight: 600;
}
.upload-btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent-strong);
}
.upload-btn:disabled {
  opacity: 0.6;
}
.hidden-input {
  display: none;
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
.grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
}
.cell {
  position: relative;
  height: 76px;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-m);
  background: var(--bg-2);
  overflow: hidden;
  cursor: grab;
}
.grid.gifs .cell {
  height: 90px;
}
.cell:hover {
  border-color: var(--accent);
}
.cell:active {
  cursor: grabbing;
}
.cell img,
.cell video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  pointer-events: none;
}
.badge {
  position: absolute;
  right: 4px;
  bottom: 4px;
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.62);
  color: #fff;
  font-size: 8.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}
.del {
  position: absolute;
  top: 4px;
  right: 4px;
  display: flex;
  padding: 3px;
  border: none;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  opacity: 0;
  transition: opacity 0.12s;
}
.cell:hover .del,
.audio-row:hover .del {
  opacity: 1;
}
.del:hover {
  background: var(--red);
}
.cell.skeleton {
  border-color: var(--border-0);
  background: linear-gradient(100deg, var(--bg-2) 40%, var(--bg-3) 50%, var(--bg-2) 60%);
  background-size: 200% 100%;
  animation: uploads-shimmer 1.2s infinite linear;
  cursor: default;
}
@keyframes uploads-shimmer {
  from {
    background-position: 120% 0;
  }
  to {
    background-position: -80% 0;
  }
}
.audio-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.audio-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 26px 7px 9px;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-m);
  background: var(--bg-2);
  color: var(--text-1);
  font-size: 11px;
  cursor: pointer;
}
.audio-row:hover {
  border-color: var(--accent);
}
.audio-row .name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.audio-row .dur {
  color: var(--text-3);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
.audio-row .del {
  top: 50%;
  transform: translateY(-50%);
}
.audio-row.pending {
  cursor: default;
  color: var(--text-3);
}
.spinner {
  width: 12px;
  height: 12px;
  border: 2px solid var(--border-1);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: uploads-spin 0.8s linear infinite;
}
@keyframes uploads-spin {
  to {
    transform: rotate(360deg);
  }
}
.state-box {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 10px;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-m);
  background: var(--bg-2);
  font-size: 11px;
  color: var(--text-2);
}
.state-box p {
  margin: 0;
  line-height: 1.45;
  word-break: break-word;
}
.state-box.error {
  border-color: color-mix(in srgb, var(--red) 50%, transparent);
  color: var(--red);
}
</style>

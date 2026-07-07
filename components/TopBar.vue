<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { useProjectStore } from '~/stores/project'
import { useEditorStore } from '~/stores/editor'
import { useCloud } from '~/composables/useCloud'
import {
  RESOLUTION_PRESET_NAMES,
  RESOLUTION_PRESETS,
  SUPPORTED_FORMATS,
} from '~/shared/schema/constants'

const project = useProjectStore()
const editor = useEditorStore()
const cloud = useCloud()

const dims = computed(() => project.defaults)
const isImage = computed(() => project.isImage)

/** image projects encode to png/jpg/webp (jpeg normalizes to jpg upstream) */
const IMAGE_FORMATS = ['png', 'jpg', 'webp'] as const
const formatOptions = computed(() =>
  isImage.value ? IMAGE_FORMATS : SUPPORTED_FORMATS
)

/* "New" chooser: video or image project */
const newMenuOpen = ref(false)
const newMenuRoot = ref<HTMLElement | null>(null)
function onDocClick(e: MouseEvent) {
  if (newMenuOpen.value && newMenuRoot.value && !newMenuRoot.value.contains(e.target as Node)) {
    newMenuOpen.value = false
  }
}
onMounted(() => document.addEventListener('mousedown', onDocClick))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocClick))

function startNew(type: 'video' | 'image') {
  newMenuOpen.value = false
  project.newProject(type)
  editor.clearSelection()
  editor.setContext('root')
  editor.setCloudProject(null)
}

const resolutionLabel = (r: string) => {
  const p = RESOLUTION_PRESETS[r as keyof typeof RESOLUTION_PRESETS]
  return p ? `${r} · ${p.width}×${p.height}` : r
}

function setResolution(e: Event) {
  const value = (e.target as HTMLSelectElement).value
  const patch: Record<string, any> = { resolution: value }
  if (value === 'custom') {
    patch.width = project.doc.width ?? dims.value.width
    patch.height = project.doc.height ?? dims.value.height
  }
  project.patchProject(patch)
}

</script>

<template>
  <header class="topbar">
    <div class="brand" title="Zvid Editor">
      <span class="brand-mark">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
          <path
            d="M6 8h12l-8 8h8"
            stroke="#fff"
            stroke-width="3"
            stroke-linecap="round"
            stroke-linejoin="round"
            fill="none"
          />
        </svg>
      </span>
      <span class="brand-name">zvid<b>editor</b></span>
    </div>

    <input
      class="name-input"
      :value="project.doc.name ?? ''"
      placeholder="Untitled project"
      spellcheck="false"
      title="Project name (output file name)"
      @change="project.patchProject({ name: ($event.target as HTMLInputElement).value || undefined })"
    />

    <div class="settings">
      <select
        class="ctl"
        :value="project.doc.resolution ?? 'custom'"
        title="Resolution preset"
        @change="setResolution"
      >
        <option v-for="r in RESOLUTION_PRESET_NAMES" :key="r" :value="r">
          {{ resolutionLabel(r) }}
        </option>
      </select>

      <template v-if="(project.doc.resolution ?? 'custom') === 'custom'">
        <UiNumberInput
          class="w-64"
          :model-value="project.doc.width"
          :min="16"
          :step="2"
          placeholder="width"
          title="Width (px)"
          @update:model-value="project.patchProject({ width: $event })"
        />
        <span class="x">×</span>
        <UiNumberInput
          class="w-64"
          :model-value="project.doc.height"
          :min="16"
          :step="2"
          placeholder="height"
          title="Height (px)"
          @update:model-value="project.patchProject({ height: $event })"
        />
      </template>
      <span v-else class="dim-badge mono">{{ dims.width }}×{{ dims.height }}</span>

      <span class="sep" />

      <span v-if="isImage" class="dim-badge mode-badge" title="Still-image project">IMAGE</span>

      <template v-if="!isImage">
        <label class="mini-field" title="Timeline duration (seconds)">
          <UiIcon name="clock" :size="13" />
          <UiNumberInput
            class="w-56"
            :model-value="project.doc.duration"
            :min="0.1"
            :step="0.5"
            placeholder="10"
            @update:model-value="project.patchProject({ duration: $event })"
          />
          <span class="suffix">s</span>
        </label>

        <label class="mini-field" title="Frame rate">
          <UiIcon name="film" :size="13" />
          <UiNumberInput
            class="w-48"
            :model-value="project.doc.frameRate"
            :min="1"
            :max="120"
            placeholder="30"
            @update:model-value="project.patchProject({ frameRate: $event })"
          />
          <span class="suffix">fps</span>
        </label>
      </template>

      <label class="mini-field" title="Background color">
        <input
          class="ctl"
          type="color"
          :value="dims.backgroundColor.slice(0, 7)"
          @input="project.patchProject({ backgroundColor: ($event.target as HTMLInputElement).value })"
        />
      </label>

      <select
        class="ctl"
        :value="project.doc.outputFormat ?? (isImage ? 'png' : 'mp4')"
        title="Output format"
        @change="project.patchProject({ outputFormat: ($event.target as HTMLSelectElement).value })"
      >
        <option v-for="f in formatOptions" :key="f" :value="f">{{ f }}</option>
      </select>
    </div>

    <div class="spacer" />

    <button
      class="icon-btn"
      :disabled="!project.canUndo"
      title="Undo (Ctrl+Z)"
      @click="project.undo()"
    >
      <UiIcon name="undo" />
    </button>
    <button
      class="icon-btn"
      :disabled="!project.canRedo"
      title="Redo (Ctrl+Y)"
      @click="project.redo()"
    >
      <UiIcon name="redo" />
    </button>

    <button
      class="icon-btn"
      :title="editor.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
      @click="editor.toggleTheme()"
    >
      <UiIcon :name="editor.theme === 'dark' ? 'sun' : 'moon'" />
    </button>

    <button class="icon-btn" title="Keyboard shortcuts (?)" @click="editor.openModal('shortcuts')">
      <UiIcon name="keyboard" />
    </button>

    <div class="divider" />

    <button class="btn ghost" title="Load an example project" @click="editor.openModal('examples')">
      <UiIcon name="folder" :size="14" /> Examples
    </button>
    <div ref="newMenuRoot" class="new-wrap">
      <button class="btn ghost" title="New empty project" @click="newMenuOpen = !newMenuOpen">
        New <UiIcon name="chevron_down" :size="12" />
      </button>
      <div v-if="newMenuOpen" class="new-menu">
        <button class="item" @click="startNew('video')">
          <UiIcon name="video" :size="14" /> Video project
        </button>
        <button class="item" @click="startNew('image')">
          <UiIcon name="image" :size="14" /> Image project
        </button>
      </div>
    </div>
    <button class="btn" @click="editor.openModal('import')">
      <UiIcon name="upload" :size="14" /> Import
    </button>
    <button
      class="btn"
      :title="
        editor.cloudProject
          ? `Save to “${editor.cloudProject.name}” in your account`
          : 'Save this project to your Zvid account'
      "
      @click="cloud.saveToCloud()"
    >
      <UiIcon name="save" :size="14" /> Save
    </button>
    <button
      class="btn"
      :title="`Render this project to ${isImage ? 'an image' : 'a video'} in the Zvid cloud`"
      @click="editor.openModal('render')"
    >
      <UiIcon name="render" :size="14" /> Render
    </button>
    <button class="btn primary" title="Export the zvid JSON" @click="editor.openModal('export')">
      <UiIcon name="export" :size="14" /> Export
    </button>

    <div class="divider" />
    <AccountMenu />
  </header>
</template>

<style scoped>
.topbar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 52px;
  padding: 0 14px;
  background: var(--bg-1);
  border-bottom: 1px solid var(--border-0);
  flex: 0 0 auto;
  z-index: 20;
}
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  user-select: none;
  margin-right: 2px;
}
.brand-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 9px;
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  box-shadow: 0 2px 6px color-mix(in srgb, var(--accent) 35%, transparent);
}
.brand-name {
  font-size: 14px;
  color: var(--text-1);
  letter-spacing: -0.01em;
}
.brand-name b {
  color: var(--text-0);
  font-weight: 700;
}
.name-input {
  width: 170px;
  height: 30px;
  padding: 0 9px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-0);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-s);
  outline: none;
  transition:
    border-color 0.12s,
    background 0.12s,
    box-shadow 0.12s;
}
.name-input:hover {
  background: var(--bg-2);
  border-color: var(--border-1);
}
.name-input:focus {
  background: var(--bg-1);
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-ring);
}
.name-input::placeholder {
  color: var(--text-3);
  font-weight: 500;
}
.settings {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 10px;
  height: 38px;
  border: 1px solid var(--border-0);
  border-radius: var(--radius-m);
  background: var(--bg-2);
}
.sep {
  width: 1px;
  height: 18px;
  background: var(--border-1);
}
.settings .ctl,
.settings :deep(input.ctl) {
  background: var(--bg-1);
}
.divider {
  width: 1px;
  height: 24px;
  background: var(--border-1);
  margin: 0 2px;
}
.x {
  color: var(--text-3);
}
.w-64 {
  width: 64px;
}
.w-56 {
  width: 56px;
}
.w-48 {
  width: 48px;
}
.dim-badge {
  font-size: 11px;
  color: var(--text-2);
  background: var(--bg-1);
  border: 1px solid var(--border-0);
  padding: 4px 7px;
  border-radius: var(--radius-s);
}
.mini-field {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--text-2);
}
.mode-badge {
  font-weight: 800;
  letter-spacing: 0.08em;
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 40%, transparent);
}
.new-wrap {
  position: relative;
}
.new-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 160px;
  padding: 5px;
  background: var(--bg-2);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-m);
  box-shadow: var(--shadow-2);
  z-index: 50;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.new-menu .item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  border: none;
  border-radius: var(--radius-s);
  background: none;
  color: var(--text-1);
  font-size: 12px;
  font-weight: 600;
  text-align: left;
}
.new-menu .item:hover {
  background: var(--bg-3);
  color: var(--text-0);
}
.suffix {
  font-size: 10px;
  color: var(--text-3);
}
.spacer {
  flex: 1;
}

@media (max-width: 1360px) {
  .brand-name {
    display: none;
  }
}
</style>

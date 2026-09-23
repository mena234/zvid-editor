<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useProjectStore } from '~/stores/project'
import { useEditorStore } from '~/stores/editor'
import { useTourStore } from '~/stores/tour'
import { useCloud } from '~/composables/useCloud'
import { useSupportChat } from '~/composables/useSupportChat'
import { ZVID_DISCORD_URL } from '~/utils/community'
import {
  RESOLUTION_PRESET_NAMES,
  RESOLUTION_PRESETS,
  SUPPORTED_FORMATS,
} from '~/shared/schema/constants'

const project = useProjectStore()
const editor = useEditorStore()
const cloud = useCloud()
const tour = useTourStore()
const support = useSupportChat()
const helpOpen = ref(false)
let supportRequest = 0

function openHelp() {
  supportRequest++
  support.hide()
  helpOpen.value = true
  activePopover.value = null
  newMenuOpen.value = false
}

function closeHelp() {
  supportRequest++
  helpOpen.value = false
}

async function openSupportChat() {
  const request = ++supportRequest
  if (!await support.load() || request !== supportRequest || !helpOpen.value || editor.modal) return
  closeHelp()
  // Release the Help dialog's focus trap before focusing the chat iframe.
  await nextTick()
  support.show()
}

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
const activePopover = ref<'tools' | 'settings' | null>(null)
const toolsRoot = ref<HTMLElement | null>(null)
const settingsRoot = ref<HTMLElement | null>(null)
function togglePopover(name: 'tools' | 'settings') {
  activePopover.value = activePopover.value === name ? null : name
  newMenuOpen.value = false
}
function closePopover() {
  const root = activePopover.value === 'tools' ? toolsRoot.value : settingsRoot.value
  activePopover.value = null
  newMenuOpen.value = false
  root?.querySelector<HTMLButtonElement>('.popover-toggle')?.focus()
}
function onDocClick(e: MouseEvent) {
  if (activePopover.value) {
    const root = activePopover.value === 'tools' ? toolsRoot.value : settingsRoot.value
    if (!root?.contains(e.target as Node)) activePopover.value = null
  }
  if (newMenuOpen.value && newMenuRoot.value && !newMenuRoot.value.contains(e.target as Node)) {
    newMenuOpen.value = false
  }
}
onMounted(() => document.addEventListener('pointerdown', onDocClick))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocClick))
watch(() => editor.modal, () => {
  activePopover.value = null
  newMenuOpen.value = false
  closeHelp()
})
watch(() => tour.current?.target, (target) => {
  activePopover.value = target === 'project-settings' ? 'settings' : target === 'examples' ? 'tools' : null
})

function startNew(type: 'video' | 'image') {
  newMenuOpen.value = false
  activePopover.value = null
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
  <header class="topbar" @keydown.esc.stop="closePopover">
    <div class="project-identity">
    <div class="brand" title="Zvid Editor">
      <span class="brand-logo-wrap">
        <img
          class="brand-logo"
          src="https://cdn.zvid.io/assets/logo.svg"
          alt="Zvid"
          width="78"
          height="24"
        />
      </span>
      <span class="brand-name">editor</span>
    </div>

    <input
      class="name-input"
      :value="project.doc.name ?? ''"
      placeholder="Untitled project"
      spellcheck="false"
      title="Project name (output file name)"
      aria-label="Project name"
      @change="project.patchProject({ name: ($event.target as HTMLInputElement).value || undefined })"
    />
    </div>

    <div ref="settingsRoot" class="settings-wrap" :class="{ 'is-open': activePopover === 'settings' }">
      <button class="icon-btn popover-toggle" title="Project settings" aria-label="Project settings"
        aria-controls="topbar-settings" :aria-expanded="activePopover === 'settings'"
        @click="togglePopover('settings')">
        <UiIcon name="settings" />
      </button>
      <div id="topbar-settings" class="settings-popover">
    <div class="settings" data-tour="project-settings">
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
        <ProjectDuration />

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
      </div>
    </div>

    <div ref="toolsRoot" class="tools-wrap" :class="{ 'is-open': activePopover === 'tools' }">
      <button class="icon-btn popover-toggle" title="More editor actions" aria-label="More editor actions"
        aria-controls="topbar-tools" :aria-expanded="activePopover === 'tools'"
        @click="togglePopover('tools')">
        <UiIcon name="more" />
      </button>
      <div id="topbar-tools" class="secondary-actions">
    <button
      class="icon-btn"
      :disabled="!project.canUndo"
      title="Undo (Ctrl+Z)"
      @click="project.undo()"
    >
      <UiIcon name="undo" /><span class="compact-label">Undo</span>
    </button>
    <button
      class="icon-btn"
      :disabled="!project.canRedo"
      title="Redo (Ctrl+Y)"
      @click="project.redo()"
    >
      <UiIcon name="redo" /><span class="compact-label">Redo</span>
    </button>

    <button
      class="icon-btn"
      :title="editor.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
      @click="editor.toggleTheme()"
    >
      <UiIcon :name="editor.theme === 'dark' ? 'sun' : 'moon'" />
      <span class="compact-label">{{ editor.theme === 'dark' ? 'Light mode' : 'Dark mode' }}</span>
    </button>

    <button class="icon-btn" title="Keyboard shortcuts (?)" @click="editor.openModal('shortcuts')">
      <UiIcon name="keyboard" />
      <span class="compact-label">Shortcuts</span>
    </button>

    <button class="icon-btn" title="Product tour" @click="tour.start()">
      <UiIcon name="compass" />
      <span class="compact-label">Product tour</span>
    </button>

    <button class="icon-btn" title="Help" aria-label="Help" @click="openHelp">
      <UiIcon name="info" />
      <span class="compact-label">Help</span>
    </button>

    <a
      class="btn ghost"
      :href="ZVID_DISCORD_URL"
      target="_blank"
      rel="noopener noreferrer"
      title="Join the Zvid community on Discord (opens in a new tab)"
      aria-label="Join the Zvid community on Discord (opens in a new tab)"
    >
      <UiIcon name="discord" :size="16" /> Discord
    </a>

    <div class="divider" />

    <button
      class="btn ghost"
      title="Load an example project"
      data-tour="examples"
      @click="editor.openModal('examples')"
    >
      <UiIcon name="folder" :size="14" /> Examples
    </button>
    <div ref="newMenuRoot" class="new-wrap">
      <button class="btn ghost" title="New empty project" :aria-expanded="newMenuOpen" @click="newMenuOpen = !newMenuOpen">
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
      </div>
    </div>
    <div class="output-actions" data-tour="output">
      <button
        class="btn save-action"
        aria-label="Save"
        :title="
          editor.cloudProject
            ? `Save to “${editor.cloudProject.name}” in your account`
            : 'Save this project to your Zvid account'
        "
        @click="cloud.saveToCloud()"
      >
        <UiIcon name="save" :size="14" /><span class="save-label">Save</span>
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
    </div>

    <AccountMenu />
  </header>
  <UiModal v-if="helpOpen" title="Help" width="400px" @close="closeHelp">
    <div class="help-content">
      <p>Need a hand with your project?</p>
      <button class="btn primary" :disabled="support.loading.value" @click="openSupportChat">
        {{ support.loading.value ? 'Opening chat…' : 'Chat with support' }}
      </button>
      <p v-if="support.error.value" role="status">Chat is unavailable right now. You can still contact us below.</p>
      <p>Contact Zvid at <a href="https://zvid.io/contact" target="_blank" rel="noopener noreferrer">https://zvid.io/contact</a></p>
    </div>
  </UiModal>
</template>

<style scoped>
.help-content { display: grid; gap: 12px; }
.help-content p { margin: 0; line-height: 1.5; }
.help-content .btn { justify-self: start; min-height: 40px; }
.help-content a { color: var(--accent); }
.topbar {
  position: relative;
  display: grid;
  grid-template-columns: 36px 36px minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
  min-height: 52px;
  min-width: 0;
  padding: 6px 8px;
  background: var(--bg-1);
  border-bottom: 1px solid var(--border-0);
  flex: 0 0 auto;
  z-index: 20;
}
.project-identity {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  grid-column: 1 / 4;
  grid-row: 1;
}
.topbar > :deep(.account) {
  grid-column: 4;
  grid-row: 1;
  justify-self: end;
}
.tools-wrap { grid-column: 1; grid-row: 2; }
.settings-wrap { grid-column: 2; grid-row: 2; }
.popover-toggle { width: 36px; height: 36px; }
.secondary-actions,
.settings-popover {
  display: none;
  position: absolute;
  top: calc(100% + 4px);
  left: 8px;
  right: 8px;
  max-height: calc(100dvh - 120px);
  overflow: auto;
  overscroll-behavior: contain;
  padding: 8px;
  background: var(--bg-1);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-m);
  box-shadow: var(--shadow-2);
}
.is-open > .secondary-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}
.is-open > .settings-popover { display: block; }
.secondary-actions > .btn,
.secondary-actions > .icon-btn,
.new-wrap > .btn {
  justify-content: flex-start;
  width: 100%;
  height: 36px;
  gap: 8px;
  padding-inline: 10px;
  text-decoration: none;
}
.compact-label { font-size: 12px; white-space: nowrap; }
.secondary-actions > .divider { display: none; }
.topbar .btn { flex-shrink: 0; }
.topbar > .output-actions {
  grid-row: 2;
  grid-column: 3 / 5;
  justify-content: flex-end;
  gap: 4px;
}
.output-actions .btn { height: 36px; padding-inline: 8px; }
.save-label { display: none; }
.save-action { width: 32px; }
.brand-name { display: none; }
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  user-select: none;
  margin-right: 2px;
  flex-shrink: 0;
}
.brand-logo-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 32px;
  padding: 2px 8px;
  border-radius: 8px;
  background: #100c1d;
  box-shadow: 0 2px 6px color-mix(in srgb, var(--accent) 35%, transparent);
}
.brand-logo {
  display: block;
  width: 78px;
  height: 24px;
  object-fit: contain;
}
.brand-name {
  font-size: 14px;
  color: var(--text-0);
  font-weight: 700;
  letter-spacing: -0.01em;
}
.name-input {
  width: 100%;
  min-width: 0;
  max-width: 220px;
  text-overflow: ellipsis;
  height: 30px;
  padding: 0 9px;
  font-size: 16px;
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
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
  padding: 5px 10px;
  min-height: 38px;
  border: 1px solid var(--border-0);
  border-radius: var(--radius-m);
  background: var(--bg-2);
}
.settings > :deep(*) { flex-shrink: 0; }
.settings > select { max-width: 100%; }
.settings :deep(.duration-control) { flex-wrap: wrap; min-width: 0; max-width: 100%; }
.settings :deep(.duration-popover) {
  position: static;
  width: 100%;
  box-shadow: none;
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
/* keeps the topbar's 8px rhythm while giving the tour one box to spotlight */
.output-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.new-menu {
  position: relative;
  min-width: 0;
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
@media (min-width: 40rem) {
  .name-input { font-size: 13px; }
  .topbar {
    grid-template-columns: minmax(120px, 1fr) auto auto auto auto;
    padding: 7px 12px;
    gap: 8px;
  }
  .project-identity { grid-column: 1; }
  .tools-wrap { grid-column: 2; grid-row: 1; }
  .settings-wrap { grid-column: 3; grid-row: 1; }
  .topbar > .output-actions { grid-column: 4; grid-row: 1; gap: 8px; }
  .topbar > :deep(.account) { grid-column: 5; }
  .save-label { display: inline; }
  .save-action { width: auto; }
  .secondary-actions { left: auto; width: 320px; }
  .settings-popover { left: auto; width: min(680px, calc(100% - 24px)); }
}
@media (min-width: 64rem) {
  .settings-wrap { grid-column: 1 / -1; grid-row: 2; }
  .settings-wrap > .popover-toggle { display: none; }
  .settings-popover {
    display: block;
    position: static;
    width: auto;
    max-height: none;
    overflow: visible;
    padding: 0;
    border: 0;
    box-shadow: none;
  }
  .settings :deep(.duration-control) { flex-wrap: nowrap; }
  .settings :deep(.duration-popover) {
    position: absolute;
    width: 300px;
    box-shadow: var(--shadow-2);
  }
  .brand-name { display: inline; }
}
@media (min-width: 80rem) {
  .topbar { grid-template-columns: minmax(220px, 1fr) auto auto auto; }
  .tools-wrap > .popover-toggle { display: none; }
  .secondary-actions,
  .is-open > .secondary-actions {
    position: static;
    display: flex;
    align-items: center;
    gap: 6px;
    width: auto;
    max-height: none;
    overflow: visible;
    padding: 0;
    border: 0;
    box-shadow: none;
  }
  .compact-label { display: none; }
  .secondary-actions > .btn,
  .new-wrap > .btn { width: auto; padding-inline: 10px; }
  .secondary-actions > .icon-btn { width: 28px; padding: 0; justify-content: center; }
  .secondary-actions > .divider { display: block; }
  .topbar > .output-actions { grid-column: 3; }
  .topbar > :deep(.account) { grid-column: 4; }
  .new-menu { position: absolute; top: calc(100% + 6px); right: 0; min-width: 160px; }
}
@media (pointer: coarse) {
  .name-input,
  .settings :deep(input.ctl),
  .settings select.ctl { font-size: 16px; }
  .popover-toggle,
  .output-actions .btn,
  .secondary-actions > .btn,
  .secondary-actions > .icon-btn,
  .new-wrap > .btn { min-height: 44px; }
}
</style>

<script setup lang="ts">
/* Design studio entry point + the user's saved "design stock". The studio
   itself is a full-screen modal; designs created there are saved server-side
   (per user) and listed here for reuse across projects. */
import { computed, onMounted, watch } from 'vue'
import { useEditorContext } from '~/composables/useEditorContext'
import { useAuthStore } from '~/stores/auth'
import { useDesignsStore, type SavedDesign } from '~/stores/designs'
import { designToItemPatch } from '~/utils/designer/compile'
import { round3 } from '~/utils/time'

const { project, editor, contextDuration } = useEditorContext()
const auth = useAuthStore()
const designs = useDesignsStore()

const savedDesigns = computed(() => designs.items ?? [])

onMounted(() => void designs.load())
watch(
  () => auth.user?.email,
  () => {
    designs.reset()
    void designs.load()
  }
)

// A design can be started from the selected TEXT/design visual.
const selectedVisual = computed(() =>
  editor.selectionKind === 'visual' && editor.selectedId
    ? project.visualById(editor.selectedId)
    : null
)
const canEditSelected = computed(() => {
  const v = selectedVisual.value
  return !!v && (!!v.designer || v.type === 'TEXT')
})

function newDesign() {
  editor.openDesigner(null)
}
function editSelected() {
  if (editor.selectedId) editor.openDesigner(editor.selectedId)
}

function defaultTiming() {
  const t0 = round3(Math.min(editor.playhead, Math.max(0, contextDuration.value - 1)))
  return {
    enterBegin: t0 || undefined,
    exitEnd: round3(Math.min(contextDuration.value, t0 + 5)),
  }
}

/** Insert a saved design onto the stage (same mapping as the studio's Insert). */
function useDesign(d: SavedDesign) {
  const patch = designToItemPatch(d.design)
  const added = project.addVisual(editor.context, {
    type: 'TEXT',
    ...patch,
    position: 'center-center',
    ...defaultTiming(),
  })
  editor.selectVisual(added._id)
  editor.notify(`“${d.name}” added to the stage`, 'success')
}

async function removeDesign(d: SavedDesign) {
  if (!window.confirm(`Delete “${d.name}” from your designs? Elements already using it in projects are unaffected.`))
    return
  try {
    await designs.remove(d.id)
    editor.notify('Design deleted', 'info')
  } catch (e: any) {
    editor.notify(e?.message || 'Delete failed', 'error')
  }
}

function openSignIn() {
  editor.modal = 'auth'
}
</script>

<template>
  <div class="design-panel">
    <h3 class="title">Design studio</h3>

    <button class="hero" @click="newDesign">
      <span class="hero-icon"><UiIcon name="magic" :size="22" /></span>
      <span class="hero-text">
        <b>New design</b>
        <span>Animated titles, layered illustrations, gradient text &amp; presets.</span>
      </span>
    </button>

    <button v-if="canEditSelected" class="edit-selected" @click="editSelected">
      <UiIcon name="layers" :size="14" />
      Edit selected element in Design studio
    </button>

    <!-- the user's saved design stock -->
    <div class="stock">
      <div class="stock-head">
        <h4 class="stock-title">Your designs</h4>
        <span v-if="savedDesigns.length" class="count">{{ savedDesigns.length }}</span>
      </div>

      <div v-if="designs.authRequired" class="state-box">
        <p>Sign in to save designs and reuse them across projects.</p>
        <button class="btn ghost sm" @click="openSignIn">Sign in</button>
      </div>

      <div v-else-if="designs.error" class="state-box error">
        <p>{{ designs.error }}</p>
        <button class="btn ghost sm" @click="designs.load(true)">Retry</button>
      </div>

      <p v-else-if="designs.loading && !savedDesigns.length" class="hint">Loading your designs…</p>

      <p v-else-if="!savedDesigns.length" class="empty-note">
        No saved designs yet — create one with <b>New design</b> and it'll appear
        here for every project.
      </p>

      <div v-else class="design-grid">
        <div
          v-for="d in savedDesigns"
          :key="d.id"
          class="design-card"
          :title="`${d.name} — click to add to the stage`"
          @click="useDesign(d)"
        >
          <DesignerMiniPreview :design="d.design" />
          <span class="design-name">{{ d.name }}</span>
          <button class="del" title="Delete design" @click.stop="removeDesign(d)">
            <UiIcon name="trash" :size="12" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.design-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.title {
  margin: 0;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-1);
  text-transform: uppercase;
  letter-spacing: 0.4px;
}
.hero {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 14px;
  border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
  border-radius: var(--radius-l, 12px);
  background: var(--accent-soft);
  color: var(--accent-strong);
  text-align: left;
}
.hero:hover {
  border-color: var(--accent);
}
.hero-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: color-mix(in srgb, var(--accent) 22%, transparent);
}
.hero-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.hero-text b {
  font-size: 14px;
}
.hero-text span {
  font-size: 11px;
  line-height: 1.4;
  color: var(--accent-strong);
  opacity: 0.85;
}
.edit-selected {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 9px 11px;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-m);
  background: var(--bg-2);
  color: var(--text-1);
  font-size: 11px;
  font-weight: 600;
}
.edit-selected:hover {
  border-color: var(--accent);
  color: var(--accent-strong);
}
.stock {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.stock-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.stock-title {
  margin: 0;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-1);
  text-transform: uppercase;
  letter-spacing: 0.4px;
}
.count {
  min-width: 16px;
  padding: 0 5px;
  border-radius: 8px;
  background: var(--bg-3);
  color: var(--text-2);
  font-size: 9.5px;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
}
.design-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}
.design-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 6px;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-m);
  background: var(--bg-2);
  cursor: pointer;
}
.design-card:hover {
  border-color: var(--accent);
}
.design-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10.5px;
  color: var(--text-1);
}
.del {
  position: absolute;
  top: 5px;
  right: 5px;
  display: flex;
  padding: 3px;
  border: none;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  opacity: 0;
  transition: opacity 0.12s;
}
.design-card:hover .del {
  opacity: 1;
}
.del:hover {
  background: var(--red);
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
}
.state-box.error {
  border-color: color-mix(in srgb, var(--red) 50%, transparent);
  color: var(--red);
}
.hint {
  margin: 0;
}
</style>

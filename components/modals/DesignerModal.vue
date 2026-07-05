<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useEditorContext } from '~/composables/useEditorContext'
import type { DesignDoc, DesignLayer } from '~/utils/designer/types'
import {
  makeDesign,
  makeImageLayer,
  makeLayerId,
  makeShapeLayer,
  makeTextLayer,
  normalizeDesign,
} from '~/utils/designer/types'
import { compileDesign, designToItemPatch } from '~/utils/designer/compile'
import {
  fetchLibraryContent,
  fetchLibraryPage,
  libraryErrorMessage,
  type LibraryItem,
} from '~/composables/useLibrary'
import { loadGoogleFont } from '~/utils/fonts'
import { round3 } from '~/utils/time'
import { useTemplateVars } from '~/composables/useTemplateVars'

const { project, editor, contextDuration, activeScene } = useEditorContext()
const tvars = useTemplateVars()

/* ---------------- source design ---------------- */
const targetId = editor.designerTargetId
const targetItem = targetId ? project.visualById(targetId) : undefined

function seedDesign(): DesignDoc {
  if (targetItem?.designer) {
    return normalizeDesign(JSON.parse(JSON.stringify(targetItem.designer)))
  }
  if (targetItem) {
    // existing plain TEXT element → start from its content & basic style
    const style = targetItem.style ?? {}
    const fontSize = parseFloat(String(style.fontSize ?? '')) || 64
    return makeDesign({
      fontFamily: style.fontFamily ?? 'Poppins',
      layers: [
        makeTextLayer({
          text: targetItem.text ?? 'Your text',
          fontSize,
          fontWeight: String(style.fontWeight ?? '700'),
          fill: { kind: 'solid', color: style.color ?? '#ffffff' },
          anim: { preset: 'rise', duration: 0.55, delay: 0, stagger: 0.04, easing: 'smooth', dir: 'up' },
        }),
      ],
    })
  }
  return makeDesign({
    layers: [
      makeTextLayer({
        text: 'Your text here',
        fontSize: 72,
        fill: { kind: 'gradient', from: '#a78bfa', to: '#e879f9', angle: 100 },
        anim: { preset: 'letter-pop', duration: 0.45, delay: 0.1, stagger: 0.055, easing: 'overshoot', dir: 'up' },
      }),
    ],
  })
}

const design = reactive<DesignDoc>(seedDesign())
const selectedId = ref<string | null>(design.layers.length ? design.layers[design.layers.length - 1].id : null)
const selectedLayer = computed(
  () => design.layers.find((l) => l.id === selectedId.value) ?? null
)

const compiled = computed(() => compileDesign(design))

watch(
  () => design.fontFamily,
  (f) => loadGoogleFont(f),
  { immediate: true }
)

/* ---------------- mutations ---------------- */
function patchDesign(patch: Record<string, any>) {
  Object.assign(design, patch)
}

function patchLayer(id: string, patch: Record<string, any>) {
  const l = design.layers.find((x) => x.id === id) as Record<string, any> | undefined
  if (!l) return
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete l[k]
    else l[k] = v
  }
}

function addLayer(kind: 'text' | 'shape' | 'image') {
  const layer: DesignLayer =
    kind === 'text'
      ? makeTextLayer({ text: 'New text', fontSize: 48 })
      : kind === 'shape'
        ? makeShapeLayer()
        : makeImageLayer()
  design.layers.push(layer)
  selectedId.value = layer.id
}

function removeLayer(id: string) {
  const i = design.layers.findIndex((l) => l.id === id)
  if (i >= 0) design.layers.splice(i, 1)
  if (selectedId.value === id)
    selectedId.value = design.layers[Math.min(i, design.layers.length - 1)]?.id ?? null
}

function duplicateLayer(id: string) {
  const src = design.layers.find((l) => l.id === id)
  if (!src) return
  const copy = JSON.parse(JSON.stringify(src)) as DesignLayer
  copy.id = makeLayerId()
  copy.x = Math.min(120, copy.x + 4)
  copy.y = Math.min(120, copy.y + 4)
  design.layers.push(copy)
  selectedId.value = copy.id
}

function reorderLayer(id: string, dir: 1 | -1) {
  const i = design.layers.findIndex((l) => l.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= design.layers.length) return
  const [l] = design.layers.splice(i, 1)
  design.layers.splice(j, 0, l)
}

function toggleHidden(id: string) {
  const l = design.layers.find((x) => x.id === id)
  if (l) l.hidden = !l.hidden
}

function moveLayer(id: string, x: number, y: number) {
  patchLayer(id, { x, y })
}

/* ---------------- templates (served by the orch content library) --------
   1000+ items: paginated thumbnail grid (meta.thumbnail from the CDN), each
   tile plays its preview video (meta.preview) while hovered; the content
   JSON is only fetched when a template is applied. */
const TPL_PAGE_SIZE = 12
const templatesOpen = ref(false)
const templatesPending = ref(false)
const templatesMorePending = ref(false)
const templatesError = ref('')
const templates = ref<LibraryItem[]>([])
const templatesTotal = ref(0)
const templatesHasMore = ref(false)
const applyingSlug = ref('')
const hoverSlug = ref('')
const tplMenuEl = ref<HTMLElement | null>(null)
const tplSentinel = ref<HTMLElement | null>(null)
let tplObserver: IntersectionObserver | null = null

async function loadTemplates() {
  templatesPending.value = true
  templatesError.value = ''
  try {
    const page = await fetchLibraryPage('design-templates', TPL_PAGE_SIZE, 0)
    templates.value = page.items
    templatesTotal.value = page.total
    templatesHasMore.value = page.hasMore
  } catch (e) {
    templatesError.value = libraryErrorMessage(e)
  } finally {
    templatesPending.value = false
  }
}

async function loadMoreTemplates() {
  if (templatesMorePending.value || templatesPending.value || !templatesHasMore.value) return
  templatesMorePending.value = true
  try {
    const page = await fetchLibraryPage(
      'design-templates',
      TPL_PAGE_SIZE,
      templates.value.length
    )
    templates.value = [...templates.value, ...page.items]
    templatesTotal.value = page.total
    templatesHasMore.value = page.hasMore
  } catch (e) {
    templatesError.value = libraryErrorMessage(e)
  } finally {
    templatesMorePending.value = false
  }
}

// Infinite scroll inside the dropdown: the sentinel below the grid triggers
// the next page. Root = the menu itself (it's the scroll container).
watch(tplSentinel, (el) => {
  tplObserver?.disconnect()
  tplObserver = null
  if (!el) return
  tplObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMoreTemplates()
    },
    { root: tplMenuEl.value, rootMargin: '200px' }
  )
  tplObserver.observe(el)
})
onBeforeUnmount(() => tplObserver?.disconnect())

function toggleTemplates() {
  templatesOpen.value = !templatesOpen.value
  if (templatesOpen.value && !templates.value.length && !templatesPending.value) {
    loadTemplates()
  }
}

function onTplEnter(slug: string) {
  hoverSlug.value = slug
}
function onTplLeave(slug: string) {
  if (hoverSlug.value === slug) hoverSlug.value = ''
}

async function applyTemplate(item: LibraryItem) {
  if (applyingSlug.value) return
  applyingSlug.value = item.slug
  try {
    const raw = await fetchLibraryContent('design-templates', item.slug)
    // stored content has no layer ids — normalizeDesign assigns fresh ones per apply
    const doc = normalizeDesign(raw)
    design.layers.splice(0, design.layers.length, ...doc.layers)
    Object.assign(design, { ...doc, layers: design.layers })
    selectedId.value = null
    templatesOpen.value = false
  } catch (e) {
    editor.notify(libraryErrorMessage(e), 'error')
  } finally {
    applyingSlug.value = ''
  }
}

/* ---------------- insert / update ---------------- */
function defaultTiming() {
  const t0 = round3(Math.min(editor.playhead, Math.max(0, contextDuration.value - 1)))
  return {
    enterBegin: t0 || undefined,
    exitEnd: round3(Math.min(contextDuration.value, t0 + 5)),
  }
}

/** True when any layer references a {{variable}} (drives the toolbar toggle). */
const usesVars = computed(() =>
  design.layers.some(
    (l) =>
      (l.kind === 'text' && l.text.includes('{{')) ||
      (l.kind === 'image' && l.src.includes('{{'))
  )
)

/** Strict placeholder check (same rule as plain TEXT elements): every
 *  {{placeholder}} must resolve with the current defaults — orch errors on
 *  unresolvable ones at render, so they can't be saved silently. */
function invalidVarMessage(): string | null {
  for (const l of design.layers) {
    const raw = l.kind === 'text' ? l.text : l.kind === 'image' ? l.src : ''
    if (!raw.includes('{{')) continue
    const check = tvars.validateTemplateValue(raw, 'any', activeScene.value)
    if (!check.ok) return `Layer "${l.name}": ${check.message}`
  }
  return null
}

function apply() {
  const invalid = invalidVarMessage()
  if (invalid) {
    editor.notify(invalid, 'error')
    return
  }
  const patch = designToItemPatch(design)
  if (targetId && targetItem) {
    project.patchVisual(targetId, patch)
    editor.notify('Design updated', 'success')
  } else {
    const added = project.addVisual(editor.context, {
      type: 'TEXT',
      ...patch,
      position: 'center-center',
      ...defaultTiming(),
    })
    editor.selectVisual(added._id)
    editor.notify('Design added to the stage', 'success')
  }
  editor.closeModal()
}

/* delete selected layer with the keyboard (unless typing) */
function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Delete' && e.key !== 'Backspace') return
  const el = e.target as HTMLElement
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return
  if (selectedId.value) {
    e.preventDefault()
    removeLayer(selectedId.value)
  }
}
</script>

<template>
  <UiModal
    :title="targetId ? 'Design Studio — edit element' : 'Design Studio'"
    width="1120px"
    @close="editor.closeModal()"
  >
    <div class="studio" @keydown="onKeydown">
      <!-- toolbar -->
      <div class="toolbar">
        <div class="tpl-wrap">
          <button class="btn sm" @click="toggleTemplates()">
            <UiIcon name="magic" :size="13" /> Templates
            <UiIcon name="chevron_down" :size="12" />
          </button>
          <div v-if="templatesOpen" ref="tplMenuEl" class="tpl-menu">
            <p v-if="templatesPending" class="tpl-status hint">Loading templates…</p>
            <template v-else-if="templatesError && !templates.length">
              <p class="tpl-status hint">⚠ {{ templatesError }}</p>
              <button class="btn sm" @click="loadTemplates()">Retry</button>
            </template>
            <template v-else>
              <button
                v-for="t in templates"
                :key="t.slug"
                class="tpl-card"
                :class="{ busy: applyingSlug === t.slug }"
                :title="t.description ?? ''"
                @click="applyTemplate(t)"
                @mouseenter="onTplEnter(t.slug)"
                @mouseleave="onTplLeave(t.slug)"
                @focus="onTplEnter(t.slug)"
                @blur="onTplLeave(t.slug)"
              >
                <span class="tpl-shot">
                  <img
                    v-if="t.meta?.thumbnail"
                    class="tpl-thumb"
                    :src="t.meta.thumbnail"
                    :alt="t.title"
                  />
                  <span v-else class="tpl-thumb tpl-thumb-fallback">
                    <UiIcon name="magic" :size="16" />
                  </span>
                  <video
                    v-if="hoverSlug === t.slug && t.meta?.preview"
                    class="tpl-video"
                    :src="t.meta.preview"
                    autoplay
                    muted
                    loop
                    playsinline
                  />
                </span>
                <span class="tpl-name">{{ t.title }}</span>
              </button>
              <div ref="tplSentinel" class="tpl-sentinel" aria-hidden="true" />
              <p v-if="templatesMorePending" class="tpl-status hint">Loading more…</p>
              <p v-else-if="templatesError" class="tpl-status hint">⚠ {{ templatesError }}</p>
              <p v-else-if="!templatesHasMore && templates.length" class="tpl-status hint">
                All {{ templatesTotal }} templates loaded
              </p>
            </template>
          </div>
        </div>
        <span class="meta mono">{{ design.width }}×{{ design.height }}px</span>
        <span class="meta">
          loop {{ compiled.duration.toFixed(2) }}s{{ design.duration === 'auto' ? ' (auto)' : '' }}
        </span>
        <label
          v-if="usesVars"
          class="vars-toggle"
          :title="'Preview {{variable}} placeholders with their default values'"
        >
          <input v-model="editor.variablesPreview" type="checkbox" />
          variable values
        </label>
        <span class="spacer" />
        <span class="meta subtle">click empty canvas = canvas settings · drag layers to move</span>
      </div>

      <div class="cols">
        <aside class="col-left">
          <DesignerLayersPanel
            :design="design"
            :selected-id="selectedId"
            @update:selected-id="selectedId = $event"
            @add="addLayer"
            @remove="removeLayer"
            @duplicate="duplicateLayer"
            @reorder="reorderLayer"
            @toggle-hidden="toggleHidden"
          />
        </aside>

        <DesignerPreview
          :design="design"
          :selected-id="selectedId"
          @update:selected-id="selectedId = $event"
          @move="moveLayer"
        />

        <aside class="col-right">
          <DesignerInspector
            :design="design"
            :layer="selectedLayer"
            :resolved-duration="compiled.duration"
            @patch-design="patchDesign"
            @patch-layer="patchLayer"
          />
        </aside>
      </div>

      <p v-for="w in compiled.warnings" :key="w" class="hint warn">⚠ {{ w }}</p>
    </div>

    <template #footer>
      <button class="btn ghost" @click="editor.closeModal()">Cancel</button>
      <button class="btn primary" @click="apply()">
        <UiIcon name="check" :size="13" />
        {{ targetId ? 'Update element' : 'Insert element' }}
      </button>
    </template>
  </UiModal>
</template>

<style scoped>
.studio {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: min(72vh, 680px);
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 0 0 auto;
}
.tpl-wrap {
  position: relative;
}
.tpl-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 80;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  width: 700px;
  max-height: 420px;
  overflow-y: auto;
  padding: 10px;
  background: var(--bg-3);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-m);
  box-shadow: var(--shadow-2);
}
.tpl-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 4px;
  padding: 5px;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-m);
  background: var(--bg-1);
  color: var(--text-0);
  text-align: left;
}
.tpl-card:hover {
  border-color: var(--accent);
}
.tpl-card.busy {
  opacity: 0.6;
  pointer-events: none;
}
.tpl-shot {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: var(--radius-s);
  overflow: hidden;
  background: var(--bg-4);
}
.tpl-thumb {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.tpl-thumb-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-3);
}
.tpl-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.tpl-sentinel {
  grid-column: 1 / -1;
  height: 2px;
}
.tpl-status {
  grid-column: 1 / -1;
}
.tpl-name {
  font-size: 10.5px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.meta {
  font-size: 10.5px;
  color: var(--text-2);
}
.vars-toggle {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10.5px;
  color: var(--accent-strong);
  cursor: pointer;
  white-space: nowrap;
}
.meta.subtle {
  color: var(--text-3);
}
.spacer {
  flex: 1;
}
.cols {
  display: grid;
  grid-template-columns: 200px 1fr 264px;
  gap: 12px;
  flex: 1;
  min-height: 0;
}
.col-left {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
  padding-right: 2px;
}
.col-right {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.warn {
  color: var(--yellow);
  flex: 0 0 auto;
}
</style>

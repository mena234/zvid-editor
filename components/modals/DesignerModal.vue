<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
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
import { DESIGN_TEMPLATES } from '~/utils/designer/templates'
import { loadGoogleFont } from '~/utils/fonts'
import { round3 } from '~/utils/time'

const { project, editor, contextDuration } = useEditorContext()

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

/* ---------------- templates ---------------- */
const templatesOpen = ref(false)
const templateDocs = DESIGN_TEMPLATES.map((t) => ({
  id: t.id,
  label: t.label,
  hint: t.hint,
  doc: t.make(),
}))

function applyTemplate(id: string) {
  const t = DESIGN_TEMPLATES.find((x) => x.id === id)
  if (!t) return
  const doc = t.make()
  design.layers.splice(0, design.layers.length, ...doc.layers)
  Object.assign(design, { ...doc, layers: design.layers })
  selectedId.value = null
  templatesOpen.value = false
}

/* ---------------- insert / update ---------------- */
function defaultTiming() {
  const t0 = round3(Math.min(editor.playhead, Math.max(0, contextDuration.value - 1)))
  return {
    enterBegin: t0 || undefined,
    exitEnd: round3(Math.min(contextDuration.value, t0 + 5)),
  }
}

function apply() {
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
          <button class="btn sm" @click="templatesOpen = !templatesOpen">
            <UiIcon name="magic" :size="13" /> Templates
            <UiIcon name="chevron_down" :size="12" />
          </button>
          <div v-if="templatesOpen" class="tpl-menu">
            <button
              v-for="t in templateDocs"
              :key="t.id"
              class="tpl-card"
              :title="t.hint"
              @click="applyTemplate(t.id)"
            >
              <DesignerMiniPreview :design="t.doc" />
              <span class="tpl-name">{{ t.label }}</span>
              <span class="tpl-hint">{{ t.hint }}</span>
            </button>
          </div>
        </div>
        <span class="meta mono">{{ design.width }}×{{ design.height }}px</span>
        <span class="meta">
          loop {{ compiled.duration.toFixed(2) }}s{{ design.duration === 'auto' ? ' (auto)' : '' }}
        </span>
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
  padding: 6px;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-m);
  background: var(--bg-1);
  color: var(--text-0);
  text-align: left;
}
.tpl-card:hover {
  border-color: var(--accent);
}
.tpl-name {
  font-size: 11.5px;
  font-weight: 600;
}
.tpl-hint {
  font-size: 9.5px;
  color: var(--text-3);
  line-height: 1.3;
}
.meta {
  font-size: 10.5px;
  color: var(--text-2);
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

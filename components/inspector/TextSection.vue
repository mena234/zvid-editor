<script setup lang="ts">
import { computed, ref } from 'vue'
import type { VisualDoc } from '~/shared/schema/types'
import { useProjectStore } from '~/stores/project'
import { useEditorStore } from '~/stores/editor'
import { useEditorContext } from '~/composables/useEditorContext'
import { useTemplateVars } from '~/composables/useTemplateVars'
import { isAutoHugText } from '~/utils/textTemplate'

const props = defineProps<{ item: VisualDoc }>()
const project = useProjectStore()
const editor = useEditorStore()
const { activeScene } = useEditorContext()
const tvars = useTemplateVars()

const textEl = ref<HTMLTextAreaElement>()
const htmlEl = ref<HTMLTextAreaElement>()

/** Reflow edits drop a declared height so the box re-hugs the wrapped copy
 *  (`fitToBox` keeps its fixed box — the type shrinks into it instead). */
function hugPatch(p: Record<string, any>): Record<string, any> {
  if (isAutoHugText(props.item) && typeof props.item.height === 'number')
    p.height = undefined
  return p
}

/** Insert a {{placeholder}} at the caret of the content textarea. */
function insertPlaceholder(placeholder: string) {
  const el = mode.value === 'text' ? textEl.value : htmlEl.value
  const field = mode.value
  const current = (field === 'text' ? props.item.text : props.item.html) ?? ''
  const pos = el ? (el.selectionStart ?? current.length) : current.length
  const next = current.slice(0, pos) + placeholder + current.slice(pos)
  patch(hugPatch({ [field]: next }))
}

/** Strict content commit: unresolvable placeholders are rejected untouched
 *  (orch errors on them at render, so they can't be saved silently). */
function commitContent(field: 'text' | 'html', e: Event) {
  const el = e.target as HTMLTextAreaElement
  const v = el.value
  if (v.includes('{{')) {
    const check = tvars.validateTemplateValue(v, 'any', activeScene.value)
    if (!check.ok) {
      editor.notify(check.message, 'error')
      el.value = (field === 'text' ? props.item.text : props.item.html) ?? ''
      return
    }
  }
  patch(hugPatch({ [field]: v }))
}

const mode = computed<'text' | 'html'>(() =>
  props.item.html && !props.item.text ? 'html' : props.item.text !== undefined ? 'text' : 'html'
)

function patch(p: Record<string, any>) {
  project.patchVisual(props.item._id, p)
}

function setMode(m: 'text' | 'html') {
  if (m === mode.value) return
  if (m === 'html') {
    patch(hugPatch({ html: props.item.html ?? `<div>${props.item.text ?? ''}</div>`, text: undefined }))
  } else {
    patch(hugPatch({ text: props.item.text ?? stripTags(props.item.html ?? ''), html: undefined }))
  }
}

function stripTags(html: string) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

const style = computed(() => props.item.style ?? {})

/** style keys that cannot change the wrapped copy's metrics */
const NON_REFLOW_STYLE = new Set(['color', 'textAlign', 'textDecoration'])

function setStyle(key: string, value: any) {
  const next = { ...(props.item.style ?? {}) }
  if (value === undefined || value === '' || value === null) delete next[key]
  else next[key] = value
  const p: Record<string, any> = { style: Object.keys(next).length ? next : undefined }
  patch(NON_REFLOW_STYLE.has(key) ? p : hugPatch(p))
}

/** Design Studio / custom-code elements style themselves via their own
 *  CSS/JS, so the plain typography controls below are overridden. */
const typographyWarning = computed(() => {
  const cc = props.item.customCode
  const parts = [cc?.css && 'CSS', cc?.js && 'JS'].filter(Boolean)
  if (!parts.length) return null
  return (
    `This element has custom ${parts.join(' + ')} code — the typography settings below have no effect because the custom code overrides them.` +
    (props.item.designer ? ' Edit the look in the Design Studio instead.' : '')
  )
})

const fontSizePx = computed(() => {
  const raw = style.value.fontSize
  if (!raw) return undefined
  const v = parseFloat(String(raw))
  return Number.isNaN(v) ? undefined : v
})

const FONT_WEIGHTS = ['300', '400', '500', '600', '700', '800', '900', 'bold', 'normal']
</script>

<template>
  <div>
    <UiSection title="Design Studio">
      <button class="btn design-btn" @click="editor.openDesigner(item._id)">
        <UiIcon name="magic" :size="14" />
        {{ item.designer ? 'Edit design visually' : 'Create an animated design' }}
      </button>
      <p class="hint">
        {{
          item.designer
            ? 'This element was built in the Design Studio — reopen it to keep editing layers and animations visually.'
            : 'Layered illustrations, letter-by-letter text animations and templates — no HTML/CSS needed.'
        }}
      </p>
    </UiSection>

    <UiSection title="Content">
      <div class="seg-row">
        <div class="seg">
          <button :class="{ on: mode === 'text' }" @click="setMode('text')">Plain text</button>
          <button :class="{ on: mode === 'html' }" @click="setMode('html')">HTML</button>
        </div>
        <UiVarMenu
          :options="tvars.placeholderOptions(activeScene)"
          title="Insert a variable at the cursor"
          @insert="insertPlaceholder"
        />
      </div>
      <textarea
        v-if="mode === 'text'"
        ref="textEl"
        class="ctl"
        rows="3"
        :value="item.text ?? ''"
        placeholder="Your text…"
        @change="commitContent('text', $event)"
      />
      <textarea
        v-else
        ref="htmlEl"
        class="ctl mono code"
        rows="7"
        :value="item.html ?? ''"
        placeholder="<div>styled markup…</div>"
        spellcheck="false"
        @change="commitContent('html', $event)"
      />
      <p v-if="mode === 'html'" class="hint">
        Arbitrary HTML+inline CSS — rendered by a headless browser at render
        time, exactly like this preview.
      </p>
    </UiSection>

    <UiSection title="Typography">
      <p v-if="typographyWarning" class="hint warn">⚠ {{ typographyWarning }}</p>
      <UiField label="Font family (Google Fonts)" as="div">
        <UiFontPicker
          :model-value="style.fontFamily ?? 'Poppins'"
          @update:model-value="setStyle('fontFamily', $event)"
        />
      </UiField>
      <div class="grid-2">
        <UiField label="Size" hint="Default 42px">
          <UiNumberInput
            :model-value="fontSizePx"
            :min="4"
            :max="600"
            placeholder="42"
            clearable
            unit="px"
            @update:model-value="setStyle('fontSize', $event !== undefined ? `${$event}px` : undefined)"
          />
        </UiField>
        <UiField label="Weight">
          <select
            class="ctl"
            :value="style.fontWeight ?? ''"
            @change="setStyle('fontWeight', ($event.target as HTMLSelectElement).value || undefined)"
          >
            <option value="">default</option>
            <option v-for="w in FONT_WEIGHTS" :key="w" :value="w">{{ w }}</option>
          </select>
        </UiField>
      </div>
      <div class="grid-2">
        <UiField label="Color">
          <UiColorInput
            :model-value="style.color"
            clearable
            placeholder="#000000"
            @update:model-value="setStyle('color', $event)"
          />
        </UiField>
        <UiField label="Align">
          <select
            class="ctl"
            :value="style.textAlign ?? ''"
            @change="setStyle('textAlign', ($event.target as HTMLSelectElement).value || undefined)"
          >
            <option value="">default</option>
            <option value="left">left</option>
            <option value="center">center</option>
            <option value="right">right</option>
          </select>
        </UiField>
      </div>
      <div class="grid-2">
        <UiField label="Letter spacing">
          <input
            class="ctl"
            :value="style.letterSpacing ?? ''"
            placeholder="e.g. 0.1em"
            @change="setStyle('letterSpacing', ($event.target as HTMLInputElement).value || undefined)"
          />
        </UiField>
        <UiField label="Line height">
          <input
            class="ctl"
            :value="style.lineHeight ?? ''"
            placeholder="e.g. 1.4"
            @change="setStyle('lineHeight', ($event.target as HTMLInputElement).value || undefined)"
          />
        </UiField>
      </div>
      <div class="grid-2">
        <UiField label="Transform">
          <select
            class="ctl"
            :value="style.textTransform ?? ''"
            @change="setStyle('textTransform', ($event.target as HTMLSelectElement).value || undefined)"
          >
            <option value="">none</option>
            <option value="uppercase">uppercase</option>
            <option value="lowercase">lowercase</option>
            <option value="capitalize">capitalize</option>
          </select>
        </UiField>
        <UiField label="Decoration">
          <select
            class="ctl"
            :value="style.textDecoration ?? ''"
            @change="setStyle('textDecoration', ($event.target as HTMLSelectElement).value || undefined)"
          >
            <option value="">none</option>
            <option value="underline">underline</option>
            <option value="line-through">line-through</option>
            <option value="overline">overline</option>
          </select>
        </UiField>
      </div>
    </UiSection>

  </div>
</template>

<style scoped>
.design-btn {
  width: 100%;
  justify-content: center;
  border-color: color-mix(in srgb, var(--accent) 50%, transparent);
  color: var(--accent);
}
.design-btn:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-strong);
}
.seg-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: 8px;
}
.seg {
  display: flex;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-s);
  overflow: hidden;
}
.seg-row .seg {
  margin-bottom: 0;
  flex: 1;
}
.seg button {
  flex: 1;
  border: none;
  background: var(--bg-2);
  color: var(--text-2);
  font-size: 11px;
  padding: 5px;
}
.seg button.on {
  background: var(--accent-soft);
  color: var(--accent-strong);
}
.code {
  font-size: 11px;
  line-height: 1.5;
}
.warn {
  color: var(--yellow);
}
.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
</style>

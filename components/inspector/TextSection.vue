<script setup lang="ts">
import { computed, ref } from 'vue'
import type { VisualDoc } from '~/shared/schema/types'
import { useProjectStore } from '~/stores/project'
import { useEditorStore } from '~/stores/editor'
import { useEditorContext } from '~/composables/useEditorContext'
import { useTemplateVars } from '~/composables/useTemplateVars'
import { POPULAR_GOOGLE_FONTS, loadGoogleFont } from '~/utils/fonts'

const props = defineProps<{ item: VisualDoc }>()
const project = useProjectStore()
const editor = useEditorStore()
const { activeScene } = useEditorContext()
const tvars = useTemplateVars()

const textEl = ref<HTMLTextAreaElement>()
const htmlEl = ref<HTMLTextAreaElement>()

/** Insert a {{placeholder}} at the caret of the content textarea. */
function insertPlaceholder(placeholder: string) {
  const el = mode.value === 'text' ? textEl.value : htmlEl.value
  const field = mode.value
  const current = (field === 'text' ? props.item.text : props.item.html) ?? ''
  const pos = el ? (el.selectionStart ?? current.length) : current.length
  const next = current.slice(0, pos) + placeholder + current.slice(pos)
  patch({ [field]: next })
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
  patch({ [field]: v })
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
    patch({ html: props.item.html ?? `<div>${props.item.text ?? ''}</div>`, text: undefined })
  } else {
    patch({ text: props.item.text ?? stripTags(props.item.html ?? ''), html: undefined })
  }
}

function stripTags(html: string) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

const style = computed(() => props.item.style ?? {})

function setStyle(key: string, value: any) {
  const next = { ...(props.item.style ?? {}) }
  if (value === undefined || value === '' || value === null) delete next[key]
  else next[key] = value
  patch({ style: Object.keys(next).length ? next : undefined })
}

/* font picker with search */
const fontQuery = ref('')
const fontOpen = ref(false)
const fontMatches = computed(() => {
  const q = fontQuery.value.toLowerCase()
  return POPULAR_GOOGLE_FONTS.filter((f) => f.toLowerCase().includes(q)).slice(0, 30)
})
function pickFont(f: string) {
  loadGoogleFont(f)
  setStyle('fontFamily', f)
  fontOpen.value = false
  fontQuery.value = ''
}

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
      <UiField label="Font family (Google Fonts)">
        <div class="font-picker">
          <button class="ctl font-btn" @click="fontOpen = !fontOpen">
            <span :style="{ fontFamily: `'${style.fontFamily ?? 'Poppins'}'` }">{{
              style.fontFamily ?? 'Poppins'
            }}</span>
            <UiIcon name="chevron_down" :size="11" />
          </button>
          <div v-if="fontOpen" class="font-menu">
            <input
              v-model="fontQuery"
              class="ctl"
              placeholder="Search fonts…"
              autofocus
            />
            <div class="font-list">
              <button
                v-for="f in fontMatches"
                :key="f"
                class="font-item"
                @click="pickFont(f)"
              >
                {{ f }}
              </button>
              <button
                v-if="fontQuery && !fontMatches.some((f) => f.toLowerCase() === fontQuery.toLowerCase())"
                class="font-item custom"
                @click="pickFont(fontQuery)"
              >
                Use “{{ fontQuery }}” (any Google Font name works)
              </button>
            </div>
          </div>
        </div>
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
.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.font-picker {
  position: relative;
  width: 100%;
}
.font-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
}
.font-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 50;
  background: var(--bg-3);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-m);
  box-shadow: var(--shadow-2);
  padding: 6px;
}
.font-list {
  max-height: 220px;
  overflow-y: auto;
  margin-top: 5px;
}
.font-item {
  display: block;
  width: 100%;
  padding: 5px 8px;
  border: none;
  background: none;
  color: var(--text-0);
  font-size: 12px;
  text-align: left;
  border-radius: var(--radius-s);
}
.font-item:hover {
  background: var(--bg-4);
}
.font-item.custom {
  color: var(--accent-strong);
  font-size: 11px;
}
</style>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { VisualDoc } from '~/shared/schema/types'
import { useProjectStore } from '~/stores/project'
import { POPULAR_GOOGLE_FONTS, loadGoogleFont } from '~/utils/fonts'

const props = defineProps<{ item: VisualDoc }>()
const project = useProjectStore()

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

/* free-form extra CSS properties */
const extraKey = ref('')
const extraVal = ref('')
const KNOWN = new Set([
  'fontFamily',
  'fontSize',
  'fontWeight',
  'color',
  'textAlign',
  'letterSpacing',
  'lineHeight',
  'textTransform',
  'textDecoration',
  'margin',
])
const extraProps = computed(() =>
  Object.entries(style.value).filter(([k]) => !KNOWN.has(k))
)
function addExtra() {
  if (!extraKey.value.trim()) return
  setStyle(extraKey.value.trim(), extraVal.value)
  extraKey.value = ''
  extraVal.value = ''
}
</script>

<template>
  <div>
    <UiSection title="Content">
      <div class="seg">
        <button :class="{ on: mode === 'text' }" @click="setMode('text')">Plain text</button>
        <button :class="{ on: mode === 'html' }" @click="setMode('html')">HTML</button>
      </div>
      <textarea
        v-if="mode === 'text'"
        class="ctl"
        rows="3"
        :value="item.text ?? ''"
        placeholder="Your text…"
        @change="patch({ text: ($event.target as HTMLTextAreaElement).value })"
      />
      <textarea
        v-else
        class="ctl mono code"
        rows="7"
        :value="item.html ?? ''"
        placeholder="<div>styled markup…</div>"
        spellcheck="false"
        @change="patch({ html: ($event.target as HTMLTextAreaElement).value })"
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

    <UiSection title="More CSS properties" collapsible :start-open="extraProps.length > 0">
      <div v-for="[k, v] in extraProps" :key="k" class="extra-row">
        <span class="mono extra-key">{{ k }}</span>
        <input
          class="ctl"
          :value="v"
          @change="setStyle(k, ($event.target as HTMLInputElement).value)"
        />
        <button class="icon-btn xs" title="Remove" @click="setStyle(k, undefined)">
          <UiIcon name="close" :size="11" />
        </button>
      </div>
      <div class="extra-row">
        <input v-model="extraKey" class="ctl" placeholder="property (camelCase)" />
        <input v-model="extraVal" class="ctl" placeholder="value" @keydown.enter="addExtra" />
        <button class="icon-btn xs" title="Add property" @click="addExtra">
          <UiIcon name="plus" :size="12" />
        </button>
      </div>
      <p class="hint">Any CSS property is allowed (padding, background, borderRadius, textShadow…).</p>
    </UiSection>
  </div>
</template>

<style scoped>
.seg {
  display: flex;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-s);
  overflow: hidden;
  margin-bottom: 8px;
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
.extra-row {
  display: grid;
  grid-template-columns: 1fr 1fr 24px;
  gap: 5px;
  align-items: center;
}
.extra-key {
  font-size: 10.5px;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
}
.icon-btn.xs {
  width: 22px;
  height: 22px;
}
</style>

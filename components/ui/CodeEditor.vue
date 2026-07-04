<script setup lang="ts">
import { ref, computed } from 'vue'

/**
 * Lightweight JSON editor: a transparent textarea overlaid on a highlighted
 * <pre> (no dependencies). Highlights keys, strings, numbers, keywords and
 * {{placeholders}}; Tab indents; scroll stays in sync.
 */
const props = defineProps<{
  modelValue: string
  rows?: number
  placeholder?: string
}>()
const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: []
}>()

const taEl = ref<HTMLTextAreaElement>()
const preEl = ref<HTMLElement>()

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Wrap {{…}} runs inside an already-escaped chunk. */
function markVars(escaped: string): string {
  return escaped.replace(
    /\{\{[^{}]*\}\}/g,
    (m) => `<span class="tok-var">${m}</span>`
  )
}

const TOKEN_RE =
  /("(?:\\.|[^"\\])*")(\s*:)?|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|\b(true|false|null)\b|(\{\{[^{}]*\}\})/g

const highlighted = computed(() => {
  const src = props.modelValue ?? ''
  let out = ''
  let last = 0
  TOKEN_RE.lastIndex = 0
  for (const m of src.matchAll(TOKEN_RE)) {
    out += markVars(escapeHtml(src.slice(last, m.index)))
    const [, str, colon, num, kw, bare] = m
    if (str !== undefined) {
      const cls = colon !== undefined ? 'tok-key' : 'tok-str'
      out += `<span class="${cls}">${markVars(escapeHtml(str))}</span>${colon ?? ''}`
    } else if (num !== undefined) {
      out += `<span class="tok-num">${num}</span>`
    } else if (kw !== undefined) {
      out += `<span class="tok-kw">${kw}</span>`
    } else if (bare !== undefined) {
      out += `<span class="tok-var">${escapeHtml(bare)}</span>`
    }
    last = m.index! + m[0].length
  }
  out += markVars(escapeHtml(src.slice(last)))
  return out + '\n'
})

function onInput(e: Event) {
  emit('update:modelValue', (e.target as HTMLTextAreaElement).value)
}

function syncScroll() {
  if (!taEl.value || !preEl.value) return
  preEl.value.scrollTop = taEl.value.scrollTop
  preEl.value.scrollLeft = taEl.value.scrollLeft
}

function onTab(e: KeyboardEvent) {
  const el = e.target as HTMLTextAreaElement
  const start = el.selectionStart ?? 0
  const end = el.selectionEnd ?? start
  el.value = el.value.slice(0, start) + '  ' + el.value.slice(end)
  el.selectionStart = el.selectionEnd = start + 2
  emit('update:modelValue', el.value)
}

defineExpose({ focus: () => taEl.value?.focus() })
</script>

<template>
  <div class="code-ed" :style="{ height: `calc(${rows ?? 10} * 1.5em + 18px)` }">
    <pre ref="preEl" class="hl" aria-hidden="true"><code v-html="highlighted" /></pre>
    <textarea
      ref="taEl"
      class="ta mono"
      :value="modelValue"
      :placeholder="placeholder"
      spellcheck="false"
      autocapitalize="off"
      autocomplete="off"
      @input="onInput"
      @change="emit('change')"
      @scroll="syncScroll"
      @keydown.tab.prevent="onTab"
    />
  </div>
</template>

<style scoped>
.code-ed {
  position: relative;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-s);
  background: var(--bg-0);
  overflow: hidden;
}
.code-ed:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-ring);
}
.hl,
.ta {
  position: absolute;
  inset: 0;
  margin: 0;
  padding: 8px 9px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  line-height: 1.5;
  white-space: pre;
  overflow-wrap: normal;
  tab-size: 2;
}
.hl {
  overflow: hidden;
  pointer-events: none;
  color: var(--text-1);
}
.hl code {
  font: inherit;
}
.ta {
  overflow: auto;
  resize: none;
  border: none;
  outline: none;
  background: transparent;
  color: transparent;
  caret-color: var(--text-0);
}
.ta::placeholder {
  color: var(--text-3);
}
.ta::selection {
  background: color-mix(in srgb, var(--accent) 25%, transparent);
  color: transparent;
}
.hl :deep(.tok-key) {
  color: var(--accent-strong);
}
.hl :deep(.tok-str) {
  color: var(--green);
}
.hl :deep(.tok-num) {
  color: var(--yellow);
}
.hl :deep(.tok-kw) {
  color: var(--red);
}
.hl :deep(.tok-var) {
  color: var(--accent);
  font-weight: 700;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  border-radius: 3px;
}
</style>

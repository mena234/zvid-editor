<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  EditorView,
  keymap,
  lineNumbers,
  placeholder as cmPlaceholder,
  tooltips,
} from '@codemirror/view'
import { EditorState, Compartment } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import {
  bracketMatching,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
  syntaxTree,
  HighlightStyle,
} from '@codemirror/language'
import { json } from '@codemirror/lang-json'
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete'
import { tags } from '@lezer/highlight'

/**
 * CodeMirror 6 JSON editor for the editor app (twin of zvid-dash-nuxt's
 * JsonEditor). JSON language only + its own undo history. Autocomplete helps
 * with JSON syntax: brackets/quotes auto-close and a context-aware popup
 * offers object keys (`schemaKeys` + keys already in the doc), value literals
 * and {}/[]/"" scaffolds. Colours use the editor's `--*` theme tokens, which
 * flip with `data-theme`, so no per-theme overrides are needed.
 */
const props = withDefaults(
  defineProps<{
    modelValue?: string
    rows?: number
    disabled?: boolean
    placeholder?: string
    schemaKeys?: string[]
    schemaValues?: string[]
  }>(),
  {
    modelValue: '',
    rows: 6,
    disabled: false,
    placeholder: '',
    schemaKeys: () => [],
    schemaValues: () => [],
  }
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  blur: []
}>()

const hostEl = ref<HTMLElement>()
let view: EditorView | null = null
const editableComp = new Compartment()

const jsonHighlight = HighlightStyle.define([
  { tag: tags.propertyName, class: 'zvje-key' },
  { tag: tags.string, class: 'zvje-str' },
  { tag: tags.number, class: 'zvje-num' },
  { tag: [tags.bool, tags.null], class: 'zvje-kw' },
  { tag: tags.invalid, class: 'zvje-invalid' },
])

function editableExt(disabled: boolean) {
  return [EditorView.editable.of(!disabled), EditorState.readOnly.of(disabled)]
}

/* ---------------- JSON autocomplete ---------------- */
const WORD_RE = /[\w$.\-]*/
const KEY_RE = /"([^"\\]*(?:\\.[^"\\]*)*)"\s*:/g

function docKeys(state: EditorState): string[] {
  const out = new Set<string>()
  const text = state.doc.toString()
  KEY_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = KEY_RE.exec(text))) out.add(m[1])
  return [...out]
}

const VALUE_LITERALS: Completion[] = [
  { label: 'true', type: 'keyword' },
  { label: 'false', type: 'keyword' },
  { label: 'null', type: 'keyword' },
  snippetCompletion('{\n\t${}\n}', { label: '{ }', type: 'class', detail: 'object' }),
  snippetCompletion('[${}]', { label: '[ ]', type: 'class', detail: 'array' }),
  snippetCompletion('"${}"', { label: '" "', type: 'text', detail: 'string' }),
]

function enclosingContainer(state: EditorState, pos: number): 'Object' | 'Array' | null {
  const tree = syntaxTree(state)
  for (let n: any = tree.resolveInner(pos, -1); n; n = n.parent) {
    if (n.name === 'Object') return 'Object'
    if (n.name === 'Array') return 'Array'
  }
  return null
}

function applyKey(key: string) {
  return (v: EditorView, _c: Completion, from: number, to: number) => {
    let end = to
    if (v.state.doc.sliceString(end, end + 1) === '"') end += 1
    const insert = `"${key}": `
    v.dispatch({
      changes: { from, to: end, insert },
      selection: { anchor: from + insert.length },
    })
  }
}

function jsonCompletions(context: CompletionContext): CompletionResult | null {
  const { state, pos, explicit } = context
  const token = context.matchBefore(WORD_RE)
  const from = token ? token.from : pos

  const charBefore = from > 0 ? state.doc.sliceString(from - 1, from) : ''
  const inString = charBefore === '"'

  const scanTo = inString ? from - 1 : from
  const head = state.doc.sliceString(Math.max(0, scanTo - 400), scanTo)
  let k = head.length - 1
  while (k >= 0 && /\s/.test(head[k])) k--
  const gov = k >= 0 ? head[k] : ''

  const container = enclosingContainer(state, pos)
  const valuePos = gov === ':' || container === 'Array'
  const keyPos = !valuePos && (container === 'Object' || gov === '{' || gov === ',')

  if (!token?.text && !inString && !explicit) return null

  if (valuePos) {
    if (inString) {
      if (!props.schemaValues.length) return null
      return {
        from,
        options: props.schemaValues.map((val) => ({ label: val, type: 'enum' })),
        validFor: /^[\w$.\- ]*$/,
      }
    }
    return { from, options: VALUE_LITERALS, validFor: WORD_RE }
  }

  if (keyPos) {
    const keys = [...new Set([...props.schemaKeys, ...docKeys(state)])]
    if (!keys.length) return null
    const options: Completion[] = keys.map((key) => ({
      label: key,
      type: 'property',
      apply: applyKey(key),
    }))
    return { from: inString ? from - 1 : from, options, validFor: /^"?[\w$.\-]*$/ }
  }

  return null
}

onMounted(() => {
  view = new EditorView({
    parent: hostEl.value!,
    state: EditorState.create({
      doc: props.modelValue ?? '',
      extensions: [
        lineNumbers(),
        history(),
        json(),
        syntaxHighlighting(jsonHighlight),
        bracketMatching(),
        closeBrackets(),
        indentOnInput(),
        indentUnit.of('  '),
        EditorView.lineWrapping,
        tooltips({ parent: document.body }),
        autocompletion({ override: [jsonCompletions], icons: true }),
        keymap.of([
          ...closeBracketsKeymap,
          ...completionKeymap,
          ...historyKeymap,
          indentWithTab,
          ...defaultKeymap,
        ]),
        ...(props.placeholder ? [cmPlaceholder(props.placeholder)] : []),
        editableComp.of(editableExt(props.disabled)),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) emit('update:modelValue', u.state.doc.toString())
          // commit on focus loss (twin of the old textarea's native change)
          if (u.focusChanged && !u.view.hasFocus) emit('blur')
        }),
      ],
    }),
  })
})

onBeforeUnmount(() => {
  view?.destroy()
  view = null
})

watch(
  () => props.modelValue,
  (val) => {
    if (!view) return
    const current = view.state.doc.toString()
    if ((val ?? '') !== current) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: val ?? '' } })
    }
  }
)

watch(
  () => props.disabled,
  (d) => view?.dispatch({ effects: editableComp.reconfigure(editableExt(d)) })
)

defineExpose({ focus: () => view?.focus() })
</script>

<template>
  <div
    ref="hostEl"
    class="zv-json-editor"
    :class="{ disabled }"
    :style="{ height: `${rows * 18 + 16}px` }"
  />
</template>

<!-- unscoped: CodeMirror renders its own DOM (and the popup mounts in <body>) -->
<style>
.zv-json-editor {
  border: 1px solid var(--border-1);
  border-radius: var(--radius-s);
  background: var(--bg-0);
  overflow: hidden;
  transition: border-color 0.12s, box-shadow 0.12s;
}
.zv-json-editor:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-ring);
}
.zv-json-editor.disabled {
  opacity: 0.5;
  pointer-events: none;
}
.zv-json-editor .cm-editor {
  height: 100%;
  background: transparent;
  outline: none;
}
.zv-json-editor .cm-scroller {
  overflow: auto;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.5;
}
.zv-json-editor .cm-content {
  padding: 6px 0;
  caret-color: var(--text-0);
  color: var(--text-1);
}
.zv-json-editor .cm-line {
  padding: 0 8px 0 4px;
}
.zv-json-editor .cm-gutters {
  background: transparent;
  border-right: 1px solid var(--border-0);
  color: var(--text-3);
}
.zv-json-editor .cm-lineNumbers .cm-gutterElement {
  padding: 0 5px 0 8px;
  min-width: 24px;
}
.zv-json-editor .cm-cursor {
  border-left-color: var(--text-0);
}
.zv-json-editor .cm-selectionBackground,
.zv-json-editor .cm-editor ::selection {
  background: color-mix(in srgb, var(--accent) 25%, transparent) !important;
}
.zv-json-editor .cm-editor.cm-focused .cm-matchingBracket {
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  outline: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
}
.zv-json-editor .cm-placeholder {
  color: var(--text-3);
}
.zv-json-editor .zvje-key {
  color: var(--accent-strong);
}
.zv-json-editor .zvje-str {
  color: var(--green);
}
.zv-json-editor .zvje-num {
  color: var(--yellow);
}
.zv-json-editor .zvje-kw {
  color: var(--red);
}
.zv-json-editor .zvje-invalid {
  color: var(--red);
  text-decoration: underline wavy color-mix(in srgb, var(--red) 60%, transparent);
}

/* Autocomplete popup (rendered in <body>, styled globally). */
.cm-tooltip.cm-tooltip-autocomplete {
  border: 1px solid var(--border-1);
  border-radius: var(--radius-m);
  background: var(--bg-3);
  box-shadow: var(--shadow-2);
  overflow: hidden;
}
.cm-tooltip-autocomplete > ul {
  font-family: var(--font-mono);
  font-size: 11.5px;
  max-height: 15em;
}
.cm-tooltip-autocomplete > ul > li {
  padding: 3px 8px;
  color: var(--text-1);
  display: flex;
  align-items: center;
  gap: 6px;
}
.cm-tooltip-autocomplete > ul > li[aria-selected] {
  background: color-mix(in srgb, var(--accent) 18%, transparent) !important;
  color: var(--text-0) !important;
}
.cm-completionLabel {
  flex: 1;
}
.cm-completionMatchedText {
  color: var(--accent-strong);
  text-decoration: none;
  font-weight: 700;
}
.cm-completionDetail {
  color: var(--text-3);
  font-style: normal;
  font-size: 10.5px;
}
.cm-completionIcon {
  opacity: 0.7;
  padding-right: 2px;
}
</style>

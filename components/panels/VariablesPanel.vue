<script setup lang="ts">
import { computed, ref } from 'vue'
import { useProjectStore } from '~/stores/project'
import { useEditorStore } from '~/stores/editor'
import {
  collectPlaceholders,
  collectIterateRoots,
  isValidVarName,
  parseTemplateJson,
  variableTypeOf,
  type VariableType,
} from '~/shared/template/engine'

const project = useProjectStore()
const editor = useEditorStore()

const variables = computed(() => project.variables)
const names = computed(() => Object.keys(variables.value))

/** Field names the project references through dot-path placeholders
 *  ({{item.price}}, {{brand.color}}) — offered as key completions in the
 *  object/array variable editors, whose own shape has no schema. */
const fieldHints = computed(() => {
  const text = JSON.stringify(project.exportRaw())
  const out = new Set<string>()
  const re = /\{\{\s*([a-zA-Z_$][\w$]*(?:\.[\w$]+)+)\s*\}\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const segs = m[1].split('.')
    for (let i = 1; i < segs.length; i++) if (!/^\d+$/.test(segs[i])) out.add(segs[i])
  }
  return [...out]
})

/** Placeholder + iterate usage across the exported document (per root). */
const usage = computed(() => {
  const exported = project.exportRaw()
  const { roots, invalid } = collectPlaceholders(exported)
  for (const [root, count] of collectIterateRoots(exported)) {
    roots.set(root, (roots.get(root) ?? 0) + count)
  }
  return { roots, invalid }
})

/** Roots used in the doc but not declared — orch rejects these at save/render. */
const undeclared = computed(() =>
  [...usage.value.roots.keys()].filter(
    (root) => !(root in variables.value) && root !== 'item' && root !== 'index'
  )
)

const invalidExpressions = computed(() => [...usage.value.invalid])

/* ---------------- add form ---------------- */
const newName = ref('')
const newType = ref<VariableType>('string')

const nameError = computed(() => {
  const n = newName.value.trim()
  if (!n) return ''
  if (!isValidVarName(n))
    return 'Start with a letter; letters, numbers and underscores only'
  if (n in variables.value) return 'A variable with this name already exists'
  if (n === 'item' || n === 'index')
    return '"item" and "index" are reserved for iterate scenes'
  return ''
})

const DEFAULTS: Record<string, unknown> = {
  string: '',
  number: 0,
  boolean: true,
  array: [],
  object: {},
}

function addVariable(prefillName?: string) {
  const name = (prefillName ?? newName.value).trim()
  if (!name || (!prefillName && nameError.value)) return
  if (!isValidVarName(name) || name in variables.value) return
  project.setVariable(name, prefillName ? '' : DEFAULTS[newType.value])
  if (!prefillName) {
    newName.value = ''
    newType.value = 'string'
  }
  editor.notify(`Variable "${name}" added — use {{${name}}} anywhere`, 'success')
}

/* ---------------- per-row editing ---------------- */
const jsonDrafts = ref<Record<string, string>>({})
const jsonErrors = ref<Record<string, string>>({})
const renamingName = ref('')
const renameValue = ref('')
const confirmDeleteName = ref('')

function typeOf(name: string): VariableType {
  return variableTypeOf(variables.value[name])
}

function usedCount(name: string): number {
  return usage.value.roots.get(name) ?? 0
}

function setString(name: string, value: string) {
  project.setVariable(name, value)
}
function setNumber(name: string, value: number | undefined) {
  project.setVariable(name, value ?? 0)
}
function setBoolean(name: string, value: boolean) {
  project.setVariable(name, value)
}

function jsonDraftFor(name: string): string {
  return jsonDrafts.value[name] ?? JSON.stringify(variables.value[name], null, 2)
}

function jsonValid(name: string): boolean {
  const draft = jsonDrafts.value[name]
  if (draft === undefined) return true
  try {
    parseTemplateJson(draft)
    return true
  } catch {
    return false
  }
}

/** Live edit: keep the raw draft, and (debounced) commit the parsed value
 *  whenever it's valid and actually changed — so the variable never goes
 *  stale even if the editor never blurs. Invalid drafts show an error and
 *  keep the last good value. */
const commitTimers: Record<string, ReturnType<typeof setTimeout>> = {}
function onJsonInput(name: string, value: string) {
  jsonDrafts.value[name] = value
  clearTimeout(commitTimers[name])
  commitTimers[name] = setTimeout(() => {
    try {
      const parsed = parseTemplateJson(value)
      jsonErrors.value[name] = ''
      if (JSON.stringify(parsed) !== JSON.stringify(variables.value[name])) {
        project.setVariable(name, parsed)
      }
    } catch (e: any) {
      jsonErrors.value[name] = e.message
    }
  }, 350)
}

/** Blur/format flush: commit immediately and drop the draft so the text
 *  reflows to the canonical serialization. */
function commitJson(name: string) {
  clearTimeout(commitTimers[name])
  const draft = jsonDrafts.value[name]
  if (draft === undefined) return
  try {
    project.setVariable(name, parseTemplateJson(draft))
    delete jsonDrafts.value[name]
    delete jsonErrors.value[name]
  } catch (e: any) {
    jsonErrors.value[name] = e.message
  }
}

function formatJson(name: string) {
  try {
    const src = jsonDrafts.value[name] ?? JSON.stringify(variables.value[name])
    jsonDrafts.value[name] = JSON.stringify(parseTemplateJson(src), null, 2)
    commitJson(name)
  } catch {
    /* invalid — the chip already says so */
  }
}

function startRename(name: string) {
  renamingName.value = name
  renameValue.value = name
  confirmDeleteName.value = ''
}

function commitRename(oldName: string) {
  const next = renameValue.value.trim()
  renamingName.value = ''
  if (!next || next === oldName) return
  if (!isValidVarName(next) || next in variables.value) {
    editor.notify('Invalid or duplicate variable name', 'error')
    return
  }
  project.renameVariable(oldName, next)
  const used = usedCount(oldName)
  if (used > 0) {
    editor.notify(
      `Renamed — ${used} {{${oldName}}} placeholder${used > 1 ? 's' : ''} still reference the old name`,
      'info'
    )
  }
}

function removeVariable(name: string) {
  if (confirmDeleteName.value !== name && usedCount(name) > 0) {
    confirmDeleteName.value = name
    return
  }
  confirmDeleteName.value = ''
  project.removeVariable(name)
}

async function copyPlaceholder(name: string) {
  try {
    await navigator.clipboard.writeText(`{{${name}}}`)
    editor.notify(`{{${name}}} copied — paste it into any text field`, 'success')
  } catch {
    editor.notify('Clipboard unavailable', 'error')
  }
}
</script>

<template>
  <div class="vars-panel">
    <UiSection title="Template variables">
      <template #actions>
        <label class="toggle" title="Show variable values on the stage instead of {{placeholders}}">
          <input v-model="editor.variablesPreview" type="checkbox" />
          preview
        </label>
      </template>

      <p class="hint">
        Define defaults here, then write <code>{{ '\{\{name\}\}' }}</code> in any
        text, color, or URL field. Rendering via a template substitutes the
        values sent with the API call.
      </p>

      <div v-if="names.length" class="var-list">
        <div v-for="name in names" :key="name" class="var-row">
          <div class="var-head">
            <input
              v-if="renamingName === name"
              v-model="renameValue"
              class="ctl rename mono"
              spellcheck="false"
              @keydown.enter.prevent="commitRename(name)"
              @keydown.esc="renamingName = ''"
              @blur="commitRename(name)"
            />
            <button
              v-else
              class="var-name mono"
              :title="`Copy {{${name}}}`"
              @click="copyPlaceholder(name)"
            >
              {{ '\{\{' }}{{ name }}{{ '\}\}' }}
            </button>
            <span class="chip type">{{ typeOf(name) }}</span>
            <span
              class="chip"
              :class="usedCount(name) ? 'used' : 'unused'"
              :title="usedCount(name) ? `Referenced ${usedCount(name)}× in this project` : 'Not referenced yet'"
            >
              {{ usedCount(name) ? `×${usedCount(name)}` : 'unused' }}
            </span>
            <span class="spacer" />
            <button class="icon-btn sm" title="Rename" @click="startRename(name)">
              <UiIcon name="text" :size="12" />
            </button>
            <button
              class="icon-btn sm"
              :class="{ danger: confirmDeleteName === name }"
              :title="confirmDeleteName === name ? `Used ${usedCount(name)}× — click again to delete` : 'Delete variable'"
              @click="removeVariable(name)"
            >
              <UiIcon name="trash" :size="12" />
            </button>
          </div>

          <div class="var-value">
            <input
              v-if="typeOf(name) === 'string'"
              class="ctl"
              :value="variables[name] as string"
              spellcheck="false"
              placeholder="value"
              @change="setString(name, ($event.target as HTMLInputElement).value)"
            />
            <UiNumberInput
              v-else-if="typeOf(name) === 'number'"
              :model-value="variables[name] as number"
              @update:model-value="setNumber(name, $event)"
            />
            <label v-else-if="typeOf(name) === 'boolean'" class="check">
              <input
                type="checkbox"
                :checked="variables[name] as boolean"
                @change="setBoolean(name, ($event.target as HTMLInputElement).checked)"
              />
              {{ variables[name] ? 'true' : 'false' }}
            </label>
            <template v-else>
              <div class="json-bar">
                <span class="chip" :class="jsonValid(name) ? 'used' : 'bad'">
                  {{ jsonValid(name) ? 'valid JSON' : 'invalid JSON' }}
                </span>
                <button
                  class="btn ghost xs"
                  type="button"
                  title="Pretty-print and apply"
                  @click="formatJson(name)"
                >
                  format
                </button>
              </div>
              <UiJsonEditor
                :model-value="jsonDraftFor(name)"
                :rows="6"
                :schema-keys="fieldHints"
                @update:model-value="onJsonInput(name, $event)"
                @blur="commitJson(name)"
              />
              <p v-if="jsonErrors[name]" class="err">{{ jsonErrors[name] }}</p>
              <p v-else-if="typeOf(name) === 'array'" class="hint">
                {{ (variables[name] as unknown[]).length }} item{{
                  (variables[name] as unknown[]).length === 1 ? '' : 's'
                }} — usable by a scene's <b>iterate</b>
              </p>
            </template>
          </div>
        </div>
      </div>
      <p v-else class="hint empty">
        No variables yet — add one below to make this project a reusable
        template.
      </p>

      <form class="add-row" @submit.prevent="addVariable()">
        <input
          v-model="newName"
          class="ctl mono"
          placeholder="variableName"
          spellcheck="false"
        />
        <select v-model="newType" class="ctl type-select">
          <option value="string">string</option>
          <option value="number">number</option>
          <option value="boolean">boolean</option>
          <option value="array">array</option>
          <option value="object">object</option>
        </select>
        <button
          class="btn primary sm"
          type="submit"
          :disabled="!newName.trim() || !!nameError"
        >
          <UiIcon name="plus" :size="12" /> Add
        </button>
      </form>
      <p v-if="nameError" class="err">{{ nameError }}</p>
    </UiSection>

    <UiSection v-if="undeclared.length || invalidExpressions.length" title="Problems">
      <div v-for="root in undeclared" :key="root" class="problem">
        <span class="mono">{{ '\{\{' }}{{ root }}{{ '\}\}' }}</span>
        <span class="problem-msg">used but not defined — rendering will fail</span>
        <button class="btn ghost sm" @click="addVariable(root)">define</button>
      </div>
      <div v-for="expr in invalidExpressions" :key="expr" class="problem">
        <span class="mono">{{ '\{\{' }}{{ expr }}{{ '\}\}' }}</span>
        <span class="problem-msg">
          unsupported expression — only {{ '\{\{name\}\}' }} or
          {{ '\{\{name.path\}\}' }} work
        </span>
      </div>
    </UiSection>

    <UiSection title="How it works">
      <ul class="how">
        <li>
          <b>{{ '\{\{name\}\}' }}</b> alone keeps the value's type (numbers stay
          numbers); embedded in longer text it's inserted as a string.
        </li>
        <li>
          A scene's <b>iterate</b> repeats it once per item of an array
          variable — use <code>{{ '\{\{item.field\}\}' }}</code> and
          <code>{{ '\{\{index\}\}' }}</code> inside (the stage previews the
          first item).
        </li>
        <li>
          A <b>condition</b> on a scene or element drops it when the value is
          falsy (false, 0, "" or missing).
        </li>
      </ul>
    </UiSection>
  </div>
</template>

<style scoped>
.vars-panel {
  display: flex;
  flex-direction: column;
}
.toggle {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-2);
  cursor: pointer;
  user-select: none;
}
.var-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 8px 0;
}
.var-row {
  border: 1px solid var(--border-0);
  border-radius: var(--radius-m);
  background: var(--bg-2);
  padding: 8px 9px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.var-head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.var-name {
  border: none;
  background: none;
  padding: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--accent-strong);
  cursor: copy;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.var-name:hover {
  text-decoration: underline;
}
.chip {
  font-size: 9.5px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 999px;
  white-space: nowrap;
}
.chip.type {
  background: var(--bg-3);
  color: var(--text-2);
}
.chip.used {
  background: color-mix(in srgb, var(--green) 12%, transparent);
  color: var(--green);
}
.chip.unused {
  background: var(--bg-3);
  color: var(--text-3);
}
.chip.bad {
  background: color-mix(in srgb, var(--red) 12%, transparent);
  color: var(--red);
}
.json-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: 4px;
}
.btn.xs {
  padding: 2px 8px;
  font-size: 10.5px;
}
.spacer {
  flex: 1;
}
.icon-btn.sm {
  width: 22px;
  height: 22px;
}
.icon-btn.danger {
  color: var(--red);
  background: color-mix(in srgb, var(--red) 10%, transparent);
}
.var-value .ctl {
  width: 100%;
}
.json {
  font-size: 10.5px;
  line-height: 1.45;
  resize: vertical;
}
.rename {
  height: 24px;
  font-size: 12px;
  flex: 1;
  min-width: 0;
}
.check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-1);
}
.add-row {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
.add-row .ctl {
  flex: 1;
  min-width: 0;
}
.type-select {
  flex: 0 0 84px;
}
.btn.sm {
  padding: 4px 10px;
  font-size: 11.5px;
  white-space: nowrap;
}
.err {
  color: var(--red);
  font-size: 11px;
  margin: 4px 0 0;
}
.empty {
  margin: 8px 0;
}
.problem {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 8px;
  border-radius: var(--radius-s);
  background: color-mix(in srgb, var(--yellow) 8%, transparent);
  margin-bottom: 4px;
  font-size: 11px;
}
.problem .mono {
  color: var(--yellow);
  font-weight: 700;
  font-size: 10.5px;
}
.problem-msg {
  color: var(--text-1);
  flex: 1;
}
.how {
  margin: 0;
  padding-left: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 11.5px;
  color: var(--text-2);
  line-height: 1.5;
}
code,
.mono {
  font-family: var(--font-mono);
}
</style>

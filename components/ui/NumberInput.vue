<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useEditorContext } from '~/composables/useEditorContext'
import { useTemplateVars } from '~/composables/useTemplateVars'
import { useEditorStore } from '~/stores/editor'

const props = withDefaults(
  defineProps<{
    modelValue: number | string | undefined
    min?: number
    max?: number
    step?: number
    placeholder?: string
    /** allow clearing back to undefined (field falls back to package default) */
    clearable?: boolean
    unit?: string
    /**
     * Accept "{{placeholder}}" strings (resolved by the template engine at
     * render). ON by default — document fields are template-capable; pass
     * `false` for inputs bound to internal editor state.
     */
    allowVar?: boolean
  }>(),
  // explicit default: Vue would otherwise cast the absent boolean to false
  { allowVar: true }
)
const emit = defineEmits<{ 'update:modelValue': [number | string | undefined] }>()

const editorStore = useEditorStore()
const { activeScene } = useEditorContext()
const tvars = useTemplateVars()

const varAllowed = computed(() => props.allowVar)

/** Number-typed placeholders available in the current editing context. */
const varOptions = computed(() =>
  varAllowed.value ? tvars.placeholderOptions(activeScene.value, 'number') : []
)

const text = ref(format(props.modelValue))
const errorMsg = ref('')

watch(
  () => props.modelValue,
  (v) => {
    if (document.activeElement !== inputEl.value) {
      text.value = format(v)
      errorMsg.value = ''
    }
  }
)

const inputEl = ref<HTMLInputElement>()

const isVar = computed(() => varAllowed.value && text.value.includes('{{'))

function format(v: number | string | undefined): string {
  if (v === undefined || v === null) return ''
  if (typeof v === 'string') return v
  if (Number.isNaN(v)) return ''
  return String(Math.round(v * 1000) / 1000)
}

function commit() {
  const raw = text.value.trim()
  errorMsg.value = ''
  if (raw === '') {
    if (props.clearable) emit('update:modelValue', undefined)
    else text.value = format(props.modelValue)
    return
  }
  if (raw.includes('{{')) {
    if (!varAllowed.value) {
      text.value = format(props.modelValue)
      return
    }
    // Strict: unknown variables and non-number types are rejected, the
    // field stays in error state and the document is NOT updated.
    const check = tvars.validateTemplateValue(raw, 'number', activeScene.value)
    if (!check.ok) {
      errorMsg.value = check.message
      editorStore.notify(check.message, 'error')
      return
    }
    emit('update:modelValue', raw)
    return
  }
  let v = Number(raw)
  if (Number.isNaN(v)) {
    text.value = format(props.modelValue)
    return
  }
  if (props.min !== undefined) v = Math.max(props.min, v)
  if (props.max !== undefined) v = Math.min(props.max, v)
  v = Math.round(v * 1000) / 1000
  text.value = format(v)
  emit('update:modelValue', v)
}

/** Programmatic insert (variable picker): pre-filtered, commits directly. */
function setVar(placeholder: string) {
  text.value = placeholder
  commit()
}
defineExpose({ setVar })

function onInput() {
  if (errorMsg.value) errorMsg.value = ''
}

function nudge(dir: 1 | -1, e: KeyboardEvent) {
  if (isVar.value) return
  const step = (props.step ?? 1) * (e.shiftKey ? 10 : 1)
  const base =
    Number(text.value) ||
    (typeof props.modelValue === 'number' ? props.modelValue : 0)
  let v = base + dir * step
  if (props.min !== undefined) v = Math.max(props.min, v)
  if (props.max !== undefined) v = Math.min(props.max, v)
  v = Math.round(v * 1000) / 1000
  text.value = format(v)
  emit('update:modelValue', v)
}
</script>

<template>
  <span class="num-wrap" :class="{ 'has-menu': varAllowed }">
    <input
      ref="inputEl"
      v-model="text"
      class="ctl num"
      :class="{ 'var-mode': isVar, invalid: !!errorMsg }"
      type="text"
      :inputmode="varAllowed ? 'text' : 'decimal'"
      :placeholder="placeholder ?? 'auto'"
      spellcheck="false"
      :title="
        errorMsg ||
        (isVar ? 'Template placeholder — resolved to a number at render' : undefined)
      "
      @input="onInput"
      @blur="commit"
      @keydown.enter="($event.target as HTMLInputElement).blur()"
      @keydown.up.prevent="nudge(1, $event)"
      @keydown.down.prevent="nudge(-1, $event)"
    />
    <span v-if="unit && !isVar" class="unit">{{ unit }}</span>
    <UiVarMenu
      v-if="varAllowed"
      class="embed"
      :options="varOptions"
      title="Use a number variable"
      empty-text="No number variables yet."
      @insert="setVar($event)"
    />
  </span>
</template>

<style scoped>
.num-wrap {
  position: relative;
  display: flex;
  align-items: center;
  min-width: 0;
}
.num {
  width: 100%;
  font-variant-numeric: tabular-nums;
}
.num.var-mode {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--accent-strong);
  border-color: color-mix(in srgb, var(--accent) 45%, transparent);
}
.num.invalid {
  color: var(--red);
  border-color: var(--red);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--red) 20%, transparent);
}
.unit {
  position: absolute;
  right: 7px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 10px;
  color: var(--text-3);
  pointer-events: none;
}
.embed {
  position: absolute;
  right: 2px;
  top: 50%;
  transform: translateY(-50%);
  opacity: 0;
  transition: opacity 0.12s;
}
.embed :deep(.vm-btn) {
  width: 18px;
  height: 18px;
  background: var(--bg-1);
  border-radius: 4px;
}
.num-wrap:hover .embed,
.num-wrap:focus-within .embed,
.embed:has(.vm-pop) {
  opacity: 1;
}
.num-wrap.has-menu:hover .unit {
  opacity: 0;
}
</style>

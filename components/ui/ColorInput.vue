<script setup lang="ts">
import { computed } from 'vue'
import { useEditorContext } from '~/composables/useEditorContext'
import { useTemplateVars } from '~/composables/useTemplateVars'
import { useEditorStore } from '~/stores/editor'

const props = withDefaults(
  defineProps<{
    modelValue: string | undefined
    placeholder?: string
    clearable?: boolean
    /** accept "{{placeholder}}" strings; false for editor-internal state */
    allowVar?: boolean
  }>(),
  { allowVar: true }
)
const emit = defineEmits<{ 'update:modelValue': [string | undefined] }>()

const editorStore = useEditorStore()
const { activeScene } = useEditorContext()
const tvars = useTemplateVars()

const varOptions = computed(() =>
  props.allowVar ? tvars.placeholderOptions(activeScene.value, 'string') : []
)

const isVar = computed(
  () => props.allowVar && (props.modelValue ?? '').includes('{{')
)

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i

const swatch = computed(() => {
  const v = props.modelValue
  if (v && HEX_RE.test(v)) return v.slice(0, 7)
  if (isVar.value) {
    // show the resolved color when the variable previews as one
    const r = tvars.displayString(
      props.modelValue,
      activeScene.value ? tvars.scenePreviewScope(activeScene.value) : undefined
    )
    if (typeof r === 'string' && HEX_RE.test(r)) return r.slice(0, 7)
  }
  return '#000000'
})

function onPick(e: Event) {
  emit('update:modelValue', (e.target as HTMLInputElement).value)
}

function onText(e: Event) {
  const el = e.target as HTMLInputElement
  const v = el.value.trim()
  if (v === '' && props.clearable) {
    emit('update:modelValue', undefined)
    return
  }
  if (v.includes('{{')) {
    if (!props.allowVar) {
      el.value = props.modelValue ?? ''
      return
    }
    // Strict: unknown variables / non-text types are rejected untouched.
    const check = tvars.validateTemplateValue(v, 'string', activeScene.value)
    if (!check.ok) {
      editorStore.notify(check.message, 'error')
      el.value = props.modelValue ?? ''
      return
    }
  }
  emit('update:modelValue', v)
}
</script>

<template>
  <span class="color-wrap">
    <input class="ctl" type="color" :value="swatch" @input="onPick" />
    <input
      class="ctl text"
      :class="{ 'var-mode': isVar }"
      type="text"
      :value="modelValue ?? ''"
      :placeholder="placeholder ?? '#rrggbb'"
      spellcheck="false"
      :title="isVar ? 'Template placeholder — resolved at render' : undefined"
      @change="onText"
    />
    <UiVarMenu
      v-if="allowVar"
      class="embed"
      :options="varOptions"
      title="Use a text variable for this color"
      empty-text="No text variables yet."
      @insert="emit('update:modelValue', $event)"
    />
  </span>
</template>

<style scoped>
.color-wrap {
  position: relative;
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}
.text {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: 11px;
}
.text.var-mode {
  color: var(--accent-strong);
  border-color: color-mix(in srgb, var(--accent) 45%, transparent);
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
.color-wrap:hover .embed,
.color-wrap:focus-within .embed,
.embed:has(.vm-pop) {
  opacity: 1;
}
</style>

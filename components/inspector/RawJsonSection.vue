<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import type { VisualDoc } from '~/shared/schema/types'
import { visualItemSchema } from '~/shared/schema/types'
import { useProjectStore } from '~/stores/project'
import { useEditorStore } from '~/stores/editor'

const props = defineProps<{ item: VisualDoc }>()
const project = useProjectStore()
const editor = useEditorStore()

function serialize(item: VisualDoc) {
  const { _id, ...raw } = item
  return JSON.stringify(raw, null, 2)
}

const text = ref(serialize(props.item))
const error = ref('')
const dirty = ref(false)

watch(
  () => props.item,
  (item) => {
    if (!dirty.value) text.value = serialize(item)
  },
  { deep: true }
)

const canApply = computed(() => dirty.value)

function onInput(e: Event) {
  text.value = (e.target as HTMLTextAreaElement).value
  dirty.value = true
  error.value = ''
}

function apply() {
  try {
    const parsed = JSON.parse(text.value)
    const res = visualItemSchema.safeParse(parsed)
    if (!res.success) {
      error.value = res.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join('.') || 'item'}: ${i.message}`)
        .join('\n')
      return
    }
    project.replaceVisual(props.item._id, parsed)
    dirty.value = false
    error.value = ''
    editor.notify('Element JSON applied', 'success')
  } catch (e: any) {
    error.value = `JSON parse error: ${e.message}`
  }
}

function revert() {
  text.value = serialize(props.item)
  dirty.value = false
  error.value = ''
}
</script>

<template>
  <UiSection title="Raw element JSON">
    <p class="hint">
      The exact object exported for this element — every package field is
      editable here, including ones without dedicated UI.
    </p>
    <textarea
      class="ctl mono code"
      rows="18"
      :value="text"
      spellcheck="false"
      @input="onInput"
    />
    <pre v-if="error" class="err">{{ error }}</pre>
    <div class="row">
      <button class="btn primary sm" :disabled="!canApply" @click="apply">Apply</button>
      <button class="btn ghost sm" :disabled="!dirty" @click="revert">Revert</button>
    </div>
  </UiSection>
</template>

<style scoped>
.code {
  font-size: 10.5px;
  line-height: 1.5;
  white-space: pre;
}
.err {
  color: var(--red);
  font-size: 10.5px;
  white-space: pre-wrap;
  margin: 4px 0 0;
  font-family: var(--font-mono);
}
.row {
  display: flex;
  gap: 6px;
}
</style>

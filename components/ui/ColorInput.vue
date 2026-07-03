<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  modelValue: string | undefined
  placeholder?: string
  clearable?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [string | undefined] }>()

const swatch = computed(() => {
  const v = props.modelValue
  if (v && /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) return v.slice(0, 7)
  return '#000000'
})

function onPick(e: Event) {
  emit('update:modelValue', (e.target as HTMLInputElement).value)
}
function onText(e: Event) {
  const v = (e.target as HTMLInputElement).value.trim()
  if (v === '' && props.clearable) emit('update:modelValue', undefined)
  else emit('update:modelValue', v)
}
</script>

<template>
  <span class="color-wrap">
    <input class="ctl" type="color" :value="swatch" @input="onPick" />
    <input
      class="ctl text"
      type="text"
      :value="modelValue ?? ''"
      :placeholder="placeholder ?? '#rrggbb'"
      spellcheck="false"
      @change="onText"
    />
  </span>
</template>

<style scoped>
.color-wrap {
  display: flex;
  gap: 5px;
  min-width: 0;
}
.text {
  flex: 1;
  font-family: var(--font-mono);
  font-size: 11px;
}
</style>

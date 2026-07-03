<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{
  modelValue: number | undefined
  min?: number
  max?: number
  step?: number
  placeholder?: string
  /** allow clearing back to undefined (field falls back to package default) */
  clearable?: boolean
  unit?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [number | undefined] }>()

const text = ref(format(props.modelValue))

watch(
  () => props.modelValue,
  (v) => {
    if (document.activeElement !== inputEl.value) text.value = format(v)
  }
)

const inputEl = ref<HTMLInputElement>()

function format(v: number | undefined): string {
  if (v === undefined || v === null || Number.isNaN(v)) return ''
  return String(Math.round(v * 1000) / 1000)
}

function commit() {
  const raw = text.value.trim()
  if (raw === '') {
    if (props.clearable) emit('update:modelValue', undefined)
    else text.value = format(props.modelValue)
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

function nudge(dir: 1 | -1, e: KeyboardEvent) {
  const step = (props.step ?? 1) * (e.shiftKey ? 10 : 1)
  const cur = Number(text.value) || props.modelValue || 0
  let v = cur + dir * step
  if (props.min !== undefined) v = Math.max(props.min, v)
  if (props.max !== undefined) v = Math.min(props.max, v)
  v = Math.round(v * 1000) / 1000
  text.value = format(v)
  emit('update:modelValue', v)
}
</script>

<template>
  <span class="num-wrap">
    <input
      ref="inputEl"
      v-model="text"
      class="ctl num"
      type="text"
      inputmode="decimal"
      :placeholder="placeholder ?? 'auto'"
      spellcheck="false"
      @blur="commit"
      @keydown.enter="($event.target as HTMLInputElement).blur()"
      @keydown.up.prevent="nudge(1, $event)"
      @keydown.down.prevent="nudge(-1, $event)"
    />
    <span v-if="unit" class="unit">{{ unit }}</span>
  </span>
</template>

<style scoped>
.num-wrap {
  position: relative;
  display: flex;
  min-width: 0;
}
.num {
  width: 100%;
  font-variant-numeric: tabular-nums;
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
</style>

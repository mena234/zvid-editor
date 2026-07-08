<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue: number | string | undefined
    min: number
    max: number
    step?: number
    /** shown in the number box when empty; also the handle position then */
    placeholder?: string
    clearable?: boolean
    unit?: string
    allowVar?: boolean
  }>(),
  // explicit default: Vue would otherwise cast the absent boolean to false
  { allowVar: true }
)
const emit = defineEmits<{ 'update:modelValue': [number | string | undefined] }>()

const sliderValue = computed(() => {
  if (typeof props.modelValue === 'number') return props.modelValue
  const d = Number(props.placeholder)
  return Number.isNaN(d) ? props.min : d
})

function onSlide(e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  emit('update:modelValue', Math.round(v * 1000) / 1000)
}
</script>

<template>
  <span class="slider-wrap">
    <input
      type="range"
      class="slider"
      :min="min"
      :max="max"
      :step="step ?? 0.01"
      :value="sliderValue"
      @input="onSlide"
    />
    <UiNumberInput
      class="num-box"
      :model-value="modelValue"
      :min="min"
      :max="max"
      :step="step"
      :placeholder="placeholder"
      :clearable="clearable"
      :unit="unit"
      :allow-var="allowVar"
      @update:model-value="emit('update:modelValue', $event)"
    />
  </span>
</template>

<style scoped>
.slider-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  width: 100%;
}
.slider {
  flex: 1;
  min-width: 0;
}
.num-box {
  flex: 0 0 60px;
}
</style>

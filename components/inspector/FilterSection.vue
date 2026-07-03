<script setup lang="ts">
import { computed } from 'vue'
import type { VisualDoc } from '~/shared/schema/types'
import { useProjectStore } from '~/stores/project'

const props = defineProps<{ item: VisualDoc }>()
const project = useProjectStore()

const filter = computed(() => props.item.filter ?? {})

function setFilter(key: string, value: any) {
  const next: Record<string, any> = { ...(props.item.filter ?? {}) }
  if (value === undefined || value === 0 || value === '' || value === false) {
    delete next[key]
  } else {
    next[key] = value
  }
  project.patchVisual(props.item._id, {
    filter: Object.keys(next).length ? next : undefined,
  })
}

const hueDeg = computed(() => {
  const raw = filter.value['hue-rotate']
  if (raw === undefined) return undefined
  const v = parseFloat(String(raw))
  return Number.isNaN(v) ? undefined : v
})

const invertVal = computed(() => {
  const v = filter.value.invert
  if (v === undefined || v === false) return 0
  return typeof v === 'number' ? v : 1
})
</script>

<template>
  <UiSection title="Color filters" collapsible :start-open="!!item.filter">
    <UiField label="Brightness" hint="-100 … 100 (FFmpeg eq)">
      <input
        type="range"
        min="-100"
        max="100"
        step="1"
        :value="filter.brightness ?? 0"
        @input="setFilter('brightness', Number(($event.target as HTMLInputElement).value))"
      />
      <span class="mono val">{{ filter.brightness ?? 0 }}</span>
    </UiField>
    <UiField label="Contrast" hint="-100 … 100">
      <input
        type="range"
        min="-100"
        max="100"
        step="1"
        :value="filter.contrast ?? 0"
        @input="setFilter('contrast', Number(($event.target as HTMLInputElement).value))"
      />
      <span class="mono val">{{ filter.contrast ?? 0 }}</span>
    </UiField>
    <UiField label="Saturation" hint="-100 … 100">
      <input
        type="range"
        min="-100"
        max="100"
        step="1"
        :value="filter.saturate ?? 0"
        @input="setFilter('saturate', Number(($event.target as HTMLInputElement).value))"
      />
      <span class="mono val">{{ filter.saturate ?? 0 }}</span>
    </UiField>
    <UiField label="Hue rotate" hint="degrees">
      <input
        type="range"
        min="-180"
        max="180"
        step="1"
        :value="hueDeg ?? 0"
        @input="
          setFilter(
            'hue-rotate',
            Number(($event.target as HTMLInputElement).value)
              ? `${($event.target as HTMLInputElement).value}deg`
              : undefined
          )
        "
      />
      <span class="mono val">{{ hueDeg ?? 0 }}°</span>
    </UiField>
    <UiField label="Blur" hint="0–100 (% of half the shortest side)">
      <input
        type="range"
        min="0"
        max="100"
        step="1"
        :value="Number(filter.blur ?? 0)"
        @input="setFilter('blur', Number(($event.target as HTMLInputElement).value) || undefined)"
      />
      <span class="mono val">{{ filter.blur ?? 0 }}</span>
    </UiField>
    <UiField label="Invert" hint="0–1">
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        :value="invertVal"
        @input="setFilter('invert', Number(($event.target as HTMLInputElement).value) || undefined)"
      />
      <span class="mono val">{{ invertVal }}</span>
    </UiField>
    <UiField label="Color tint" hint="Multiplies the RGB channels">
      <UiColorInput
        :model-value="filter.colorTint"
        clearable
        placeholder="none"
        @update:model-value="setFilter('colorTint', $event)"
      />
    </UiField>
    <p class="hint">
      Preview uses CSS approximations — FFmpeg's contrast/saturation curves
      differ slightly at extreme values.
    </p>
  </UiSection>
</template>

<style scoped>
.val {
  flex: 0 0 34px;
  text-align: right;
  font-size: 10.5px;
  color: var(--text-1);
}
</style>

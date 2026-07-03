<script setup lang="ts">
import type { Paint } from '~/utils/designer/types'

/** Solid-or-gradient paint editor shared by fills and backgrounds. */
const props = defineProps<{ modelValue: Paint }>()
const emit = defineEmits<{ 'update:modelValue': [Paint] }>()

function setKind(kind: 'solid' | 'gradient') {
  const p = props.modelValue
  if (kind === p.kind) return
  if (kind === 'solid') {
    emit('update:modelValue', {
      kind: 'solid',
      color: p.kind === 'gradient' ? p.from : '#5b8cff',
    })
  } else {
    emit('update:modelValue', {
      kind: 'gradient',
      from: p.kind === 'solid' ? p.color : '#5b8cff',
      to: '#9d6bff',
      angle: 120,
    })
  }
}

function patch(part: Record<string, any>) {
  emit('update:modelValue', { ...props.modelValue, ...part } as Paint)
}
</script>

<template>
  <div class="paint">
    <div class="seg">
      <button :class="{ on: modelValue.kind === 'solid' }" @click="setKind('solid')">Solid</button>
      <button :class="{ on: modelValue.kind === 'gradient' }" @click="setKind('gradient')">
        Gradient
      </button>
    </div>
    <template v-if="modelValue.kind === 'solid'">
      <UiColorInput
        :model-value="modelValue.color"
        @update:model-value="patch({ color: $event ?? '#ffffff' })"
      />
    </template>
    <template v-else>
      <div class="g-row">
        <UiColorInput
          :model-value="modelValue.from"
          @update:model-value="patch({ from: $event ?? '#5b8cff' })"
        />
        <UiColorInput
          :model-value="modelValue.to"
          @update:model-value="patch({ to: $event ?? '#9d6bff' })"
        />
      </div>
      <UiField label="Angle">
        <UiNumberInput
          :model-value="modelValue.angle"
          :min="0"
          :max="360"
          :step="5"
          unit="°"
          @update:model-value="patch({ angle: $event ?? 120 })"
        />
      </UiField>
    </template>
  </div>
</template>

<style scoped>
.paint {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.seg {
  display: flex;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-s);
  overflow: hidden;
}
.seg button {
  flex: 1;
  border: none;
  background: var(--bg-2);
  color: var(--text-2);
  font-size: 10.5px;
  padding: 4px;
}
.seg button.on {
  background: var(--accent-soft);
  color: var(--accent-strong);
}
.g-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
</style>

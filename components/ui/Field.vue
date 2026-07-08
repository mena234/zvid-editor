<script setup lang="ts">
/**
 * `as` defaults to a <label> (correct for a single labelable control). Pass
 * as="div" when the slot holds a composite widget with many controls (e.g. a
 * search input + a grid of buttons) — a <label> may wrap only one labelable
 * control, and would otherwise steal clicks into the first descendant input.
 */
defineProps<{
  label: string
  hint?: string
  inline?: boolean
  as?: 'label' | 'div'
}>()
</script>

<template>
  <component :is="as ?? 'label'" class="field" :class="{ inline }">
    <span class="field-label" :title="hint">{{ label }}</span>
    <span class="field-ctl"><slot /></span>
  </component>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.field.inline {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.field-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-2);
  white-space: nowrap;
  letter-spacing: 0.01em;
}
.field-ctl {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.field-ctl > :deep(*) {
  flex: 1;
}
</style>

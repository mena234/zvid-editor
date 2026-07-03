<script setup lang="ts">
defineProps<{ label: string; hint?: string; inline?: boolean }>()
</script>

<template>
  <label class="field" :class="{ inline }">
    <span class="field-label" :title="hint">{{ label }}</span>
    <span class="field-ctl"><slot /></span>
  </label>
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

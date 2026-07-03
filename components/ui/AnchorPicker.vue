<script setup lang="ts">
import { ANCHORS, type Anchor } from '~/shared/schema/constants'

defineProps<{
  modelValue: string | undefined
  /** show a "custom"/none state */
  allowEmpty?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [string | undefined] }>()
</script>

<template>
  <div class="anchor-grid" role="radiogroup" aria-label="Anchor">
    <button
      v-for="a in ANCHORS"
      :key="a"
      type="button"
      class="dot"
      :class="{ active: modelValue === a }"
      :title="a"
      @click="emit('update:modelValue', modelValue === a && allowEmpty ? undefined : a)"
    />
  </div>
</template>

<style scoped>
.anchor-grid {
  display: grid;
  grid-template-columns: repeat(3, 16px);
  grid-template-rows: repeat(3, 16px);
  gap: 3px;
  padding: 5px;
  background: var(--bg-1);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-s);
  width: max-content;
}
.dot {
  border: 1px solid var(--border-2);
  border-radius: 3px;
  background: var(--bg-3);
  padding: 0;
  transition: all 0.1s;
}
.dot:hover {
  background: var(--bg-4);
  border-color: var(--text-3);
}
.dot.active {
  background: var(--accent);
  border-color: var(--accent-strong);
}
</style>

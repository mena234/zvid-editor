<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{ title: string; collapsible?: boolean; startOpen?: boolean }>()
const open = ref(props.startOpen ?? true)
</script>

<template>
  <section class="sec">
    <button
      v-if="collapsible"
      class="sec-head as-btn"
      type="button"
      @click="open = !open"
    >
      <UiIcon :name="open ? 'chevron_down' : 'chevron_right'" :size="12" />
      <span>{{ title }}</span>
      <span class="spacer" />
      <slot name="actions" />
    </button>
    <div v-else class="sec-head">
      <span>{{ title }}</span>
      <span class="spacer" />
      <slot name="actions" />
    </div>
    <div v-show="!collapsible || open" class="sec-body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.sec {
  border-bottom: 1px solid var(--border-0);
  padding-bottom: 12px;
  margin-bottom: 12px;
}
.sec:last-child {
  border-bottom: none;
  margin-bottom: 0;
}
.sec-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--text-2);
  padding: 4px 0 8px;
}
.sec-head.as-btn {
  width: 100%;
  background: none;
  border: none;
  color: var(--text-2);
  text-align: left;
}
.sec-head.as-btn:hover {
  color: var(--text-0);
}
.spacer {
  flex: 1;
}
.sec-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>

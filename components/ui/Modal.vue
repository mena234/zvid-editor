<script setup lang="ts">
defineProps<{ title: string; width?: string }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop" @mousedown.self="emit('close')">
      <div class="modal" :style="{ width: width ?? '640px' }">
        <header class="modal-head">
          <h2>{{ title }}</h2>
          <button class="icon-btn" aria-label="Close" @click="emit('close')">
            <UiIcon name="close" />
          </button>
        </header>
        <div class="modal-body">
          <slot />
        </div>
        <footer v-if="$slots.footer" class="modal-foot">
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(2, 4, 8, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  backdrop-filter: blur(3px);
}
.modal {
  max-width: calc(100vw - 48px);
  max-height: calc(100vh - 64px);
  display: flex;
  flex-direction: column;
  background: var(--bg-2);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-l);
  box-shadow: var(--shadow-2);
  overflow: hidden;
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px 10px;
  flex: 0 0 auto;
}
.modal-head h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.modal-body {
  padding: 4px 18px 18px;
  overflow: auto;
  min-height: 0;
}
.modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--border-0);
  background: var(--bg-1);
  flex: 0 0 auto;
}
</style>

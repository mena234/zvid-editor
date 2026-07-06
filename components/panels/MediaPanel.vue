<script setup lang="ts">
// One media-type tab (Images / Videos / Audio / GIFs): the user's uploads on
// top, the stock library below. Audio has no stock provider — uploads only.
import type { UploadKind } from '~/stores/uploads'

defineProps<{ kind: UploadKind }>()
</script>

<template>
  <div class="media-panel">
    <PanelsUploadsSection :kind="kind" />
    <template v-if="kind !== 'audio'">
      <hr class="divider" />
      <PanelsStockPanel :kind="kind" />
    </template>
  </div>
</template>

<style scoped>
.media-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}
.divider {
  margin: 2px 0;
  border: none;
  border-top: 1px solid var(--border-0);
}
</style>

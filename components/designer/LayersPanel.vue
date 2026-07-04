<script setup lang="ts">
import { computed } from 'vue'
import type { DesignDoc, DesignLayer } from '~/utils/designer/types'

const props = defineProps<{
  design: DesignDoc
  selectedId: string | null
}>()

const emit = defineEmits<{
  'update:selectedId': [string | null]
  add: [kind: 'text' | 'shape' | 'image']
  remove: [id: string]
  duplicate: [id: string]
  /** move within stacking order; dir 1 = toward front */
  reorder: [id: string, dir: 1 | -1]
  toggleHidden: [id: string]
}>()

/** UI lists front-most first; doc stores bottom → top. */
const rows = computed(() => [...props.design.layers].slice().reverse())

const KIND_ICON: Record<DesignLayer['kind'], string> = {
  text: 'text',
  shape: 'svg',
  image: 'image',
}

function label(l: DesignLayer): string {
  if (l.kind === 'text') {
    const t = l.text.replace(/\n/g, ' ').trim()
    return t.length > 18 ? `${t.slice(0, 18)}…` : t || 'Text'
  }
  return l.name
}
</script>

<template>
  <div class="layers">
    <div class="add-row">
      <button class="btn ghost sm" title="Add a text layer" @click="emit('add', 'text')">
        <UiIcon name="text" :size="13" /> Text
      </button>
      <button class="btn ghost sm" title="Add a shape / icon layer" @click="emit('add', 'shape')">
        <UiIcon name="svg" :size="13" /> Shape
      </button>
      <button class="btn ghost sm" title="Add an image layer" @click="emit('add', 'image')">
        <UiIcon name="image" :size="13" /> Image
      </button>
    </div>

    <p v-if="!rows.length" class="hint empty">
      No layers yet — add text, a shape, or start from a template.
    </p>

    <div class="rows">
      <div
        v-for="l in rows"
        :key="l.id"
        class="row"
        :class="{ active: l.id === selectedId, hidden: l.hidden }"
        @click="emit('update:selectedId', l.id)"
      >
        <UiIcon :name="KIND_ICON[l.kind]" :size="14" class="kind-icon" />
        <span class="row-label" :title="label(l)">{{ label(l) }}</span>
        <span v-if="l.anim" class="anim-dot" title="Animated" />
        <span class="row-actions" @click.stop>
          <button class="icon-btn xs" title="Move up (toward front)" @click="emit('reorder', l.id, 1)">
            <UiIcon name="chevron_up" :size="13" />
          </button>
          <button class="icon-btn xs" title="Move down (toward back)" @click="emit('reorder', l.id, -1)">
            <UiIcon name="chevron_down" :size="13" />
          </button>
          <button class="icon-btn xs" :title="l.hidden ? 'Show' : 'Hide'" @click="emit('toggleHidden', l.id)">
            <UiIcon :name="l.hidden ? 'eye-off' : 'eye'" :size="13" />
          </button>
          <button class="icon-btn xs" title="Duplicate" @click="emit('duplicate', l.id)">
            <UiIcon name="copy" :size="13" />
          </button>
          <button class="icon-btn xs danger" title="Delete layer" @click="emit('remove', l.id)">
            <UiIcon name="trash" :size="13" />
          </button>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.layers {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}
.add-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 4px;
}
.add-row .btn {
  justify-content: center;
  padding: 5px 2px;
  font-size: 10px;
}
.empty {
  padding: 8px 2px;
}
.rows {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
  min-height: 0;
}
.row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 6px;
  border-radius: var(--radius-s);
  border: 1px solid transparent;
  color: var(--text-1);
  font-size: 11px;
  cursor: pointer;
  user-select: none;
}
.row:hover {
  background: var(--bg-3);
}
.row.active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--text-0);
}
.row.hidden {
  opacity: 0.45;
}
.row-label {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.anim-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  flex: 0 0 auto;
}
.kind-icon {
  flex: 0 0 auto;
  color: var(--text-2);
}
.row.active .kind-icon {
  color: var(--accent);
}
.row-actions {
  display: none;
  gap: 2px;
}
.row:hover .row-actions,
.row.active .row-actions {
  display: flex;
}
.icon-btn.danger:hover {
  color: var(--red);
}
</style>

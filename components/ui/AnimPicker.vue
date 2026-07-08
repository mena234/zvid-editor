<script setup lang="ts">
import { ref, computed } from 'vue'
import { ANIM_GROUPS, ANIM_PRESETS } from '~/utils/designer/animations'
import { useGalleryList, type GalleryGroup } from '~/composables/useGalleryList'

/**
 * Visual replacement for the Design-Studio animation `<select>`: a searchable
 * gallery of live animation thumbnails (à la VEED / Vmaker). Each tile plays
 * the preset on a sample of the layer's kind. Emits `update:modelValue` with
 * the preset id (or `undefined` for "none / static").
 *
 * `kind` filters the presets: text layers see every group; shape/image layers
 * see only the kind-agnostic Entrance/Loop presets (text-only split presets are
 * hidden). Shares the accessible roving-tabindex listbox with EffectPicker via
 * useGalleryList.
 */
const props = defineProps<{
  modelValue: string | undefined
  kind: 'text' | 'shape' | 'image'
}>()

const emit = defineEmits<{ 'update:modelValue': [string | undefined] }>()

const q = ref('')
const filteredGroups = computed<GalleryGroup[]>(() => {
  const needle = q.value.trim().toLowerCase()
  const match = (p: (typeof ANIM_PRESETS)[string]) =>
    !needle ||
    p.id.includes(needle) ||
    p.label.toLowerCase().includes(needle) ||
    p.hint.toLowerCase().includes(needle)

  const out: GalleryGroup[] = []
  for (const g of ANIM_GROUPS) {
    const presets = Object.values(ANIM_PRESETS).filter(
      (p) => p.group === g && (props.kind === 'text' || !p.textOnly) && match(p)
    )
    if (presets.length)
      out.push({ group: g, items: presets.map((p) => ({ value: p.id, label: p.label })) })
  }
  return out
})

const { indexed, empty, activeIndex, scrollEl, choose, onKey } = useGalleryList({
  groups: () => filteredGroups.value,
  allowNone: () => true,
  selected: () => props.modelValue,
  onSelect: (v) => emit('update:modelValue', v),
})
</script>

<template>
  <div class="ap">
    <div class="ap-search">
      <UiIcon name="zoom" :size="13" />
      <input
        v-model="q"
        class="ap-q"
        type="text"
        placeholder="Search animations…"
        spellcheck="false"
        aria-label="Search animations"
      />
      <button
        v-if="q"
        class="ap-clear"
        type="button"
        aria-label="Clear search"
        @click="q = ''"
      >
        <UiIcon name="close" :size="12" />
      </button>
    </div>

    <div
      ref="scrollEl"
      class="ap-scroll"
      role="listbox"
      aria-label="Layer animation"
      @keydown="onKey"
    >
      <div class="ap-grid" role="presentation">
        <button
          class="ap-cell"
          :class="{ sel: !modelValue }"
          type="button"
          role="option"
          :aria-selected="!modelValue"
          :tabindex="activeIndex === indexed.noneIndex ? 0 : -1"
          :data-idx="indexed.noneIndex"
          title="None (static)"
          @click="choose(undefined, indexed.noneIndex)"
        >
          <span class="ap-none"><i class="ap-slash" /></span>
          <span class="ap-label">None</span>
        </button>
      </div>

      <template v-for="grp in indexed.groups" :key="grp.group">
        <div class="ap-group" aria-hidden="true">{{ grp.group }}</div>
        <div class="ap-grid" role="presentation">
          <button
            v-for="it in grp.items"
            :key="kind + ':' + it.value"
            class="ap-cell"
            :class="{ sel: modelValue === it.value }"
            type="button"
            role="option"
            :aria-selected="modelValue === it.value"
            :tabindex="activeIndex === it.index ? 0 : -1"
            :data-idx="it.index"
            :title="it.label"
            @click="choose(it.value, it.index)"
          >
            <UiAnimTile :preset-id="it.value" :kind="kind" />
            <span class="ap-label">{{ it.label }}</span>
          </button>
        </div>
      </template>

      <p v-if="empty" class="ap-empty">No animations match “{{ q }}”.</p>
    </div>
  </div>
</template>

<style scoped>
.ap {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-m);
  background: var(--bg-1);
  padding: 6px;
}
.ap-search {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: var(--radius-s);
  background: var(--bg-2);
  color: var(--text-3);
}
.ap-search:focus-within {
  box-shadow: 0 0 0 3px var(--accent-ring);
  color: var(--accent-strong);
}
.ap-q {
  flex: 1;
  min-width: 0;
  border: none;
  background: none;
  color: var(--text-0);
  font-size: 12px;
  outline: none;
}
.ap-q::placeholder {
  color: var(--text-3);
}
.ap-clear {
  display: flex;
  border: none;
  background: none;
  color: var(--text-3);
  cursor: pointer;
  padding: 0;
}
.ap-clear:hover {
  color: var(--text-0);
}
.ap-scroll {
  max-height: 268px;
  overflow-y: auto;
  padding-right: 2px;
}
.ap-group {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-3);
  padding: 8px 2px 4px;
}
.ap-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
.ap-cell {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 3px;
  border: 1px solid transparent;
  border-radius: var(--radius-s);
  background: none;
  cursor: pointer;
  min-width: 0;
}
.ap-cell:hover {
  background: var(--bg-2);
}
.ap-cell:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--accent-ring);
}
.ap-cell.sel {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}
.ap-cell.sel .ap-label {
  color: var(--accent-strong);
  font-weight: 600;
}
.ap-label {
  font-size: 10px;
  color: var(--text-2);
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* "none" tile: a muted box with a diagonal strike */
.ap-none {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 200 / 125;
  border-radius: var(--radius-s);
  background: var(--bg-3);
  overflow: hidden;
}
.ap-slash {
  position: absolute;
  top: 50%;
  left: 8%;
  width: 84%;
  height: 2px;
  background: var(--text-3);
  transform: translateY(-50%) rotate(-16deg);
  transform-origin: center;
}
.ap-empty {
  padding: 12px 4px;
  margin: 0;
  font-size: 11px;
  color: var(--text-3);
  text-align: center;
}
</style>

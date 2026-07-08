<script setup lang="ts">
import { ref, computed, provide, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { XFADE_GROUPS } from '~/shared/schema/constants'
import type { XfadeMode } from '~/utils/xfade'
import { EFFECT_CLOCK, effectLabel } from '~/utils/effectMeta'

/**
 * Visual replacement for the xfade `<select>`: a searchable gallery of
 * animated thumbnails (à la VEED / Vmaker). Tiles rest on a representative
 * still and play their motion on hover. Emits `update:modelValue` with the
 * effect id (or `undefined` for "none"). `direction` picks the preview mode:
 * enter/exit animations show one stream, transitions show both.
 */
const props = withDefaults(
  defineProps<{
    modelValue: string | undefined
    direction: XfadeMode
    /** include a "none" tile (clears the effect) */
    allowNone?: boolean
    /** label for the none tile, e.g. "None (hard cut)" */
    noneLabel?: string
  }>(),
  { allowNone: true, noneLabel: 'None' }
)

const emit = defineEmits<{ 'update:modelValue': [string | undefined] }>()

/* ---------------- shared animation clock ----------------
 * A single rAF drives every tile in this picker. It only runs while the
 * pointer is inside the gallery, so an idle picker (and the whole page)
 * settles — only the hovered tile actually reads `progress`. */
const progress = ref(0)
provide(EFFECT_CLOCK, progress)

let raf = 0
let startTs = 0
function loop(ts: number) {
  if (!startTs) startTs = ts
  const cycle = 1800
  // ramp over the first 70% of the cycle, then hold at 1 so the completed
  // state is legible before it loops
  progress.value = Math.min(1, ((ts - startTs) % cycle) / (cycle * 0.7))
  raf = requestAnimationFrame(loop)
}
function startClock() {
  if (!raf) {
    startTs = 0
    raf = requestAnimationFrame(loop)
  }
}
function stopClock() {
  if (raf) {
    cancelAnimationFrame(raf)
    raf = 0
  }
}

/* ---------------- search + grouping ---------------- */
const q = ref('')
const groups = computed(() => {
  const needle = q.value.trim().toLowerCase()
  const match = (fx: string) =>
    !needle ||
    fx.includes(needle) ||
    effectLabel(fx).toLowerCase().includes(needle)

  const out: { group: string; effects: string[] }[] = []
  // surface an effect an imported project may carry that isn't in the
  // standard groups (e.g. `distance`) so the current value stays selectable
  const known = new Set(Object.values(XFADE_GROUPS).flat() as string[])
  if (props.modelValue && !known.has(props.modelValue) && match(props.modelValue)) {
    out.push({ group: 'Current', effects: [props.modelValue] })
  }
  for (const [group, effects] of Object.entries(XFADE_GROUPS)) {
    const f = effects.filter(match)
    if (f.length) out.push({ group, effects: f })
  }
  return out
})
const empty = computed(() => groups.value.length === 0)

function choose(fx: string | undefined) {
  emit('update:modelValue', fx)
}

const scrollEl = ref<HTMLElement>()
onMounted(async () => {
  // bring the current selection into view within the gallery
  await nextTick()
  scrollEl.value
    ?.querySelector('.ep-cell.sel')
    ?.scrollIntoView({ block: 'nearest' })
})
onBeforeUnmount(() => stopClock())
</script>

<template>
  <div class="ep">
    <div class="ep-search">
      <UiIcon name="zoom" :size="13" />
      <input
        v-model="q"
        class="ep-q"
        type="text"
        placeholder="Search effects…"
        spellcheck="false"
        aria-label="Search effects"
      />
      <button
        v-if="q"
        class="ep-clear"
        type="button"
        aria-label="Clear search"
        @click="q = ''"
      >
        <UiIcon name="close" :size="12" />
      </button>
    </div>

    <div
      ref="scrollEl"
      class="ep-scroll"
      @mouseenter="startClock"
      @mouseleave="stopClock"
    >
      <div v-if="allowNone" class="ep-grid">
        <button
          class="ep-cell"
          :class="{ sel: !modelValue }"
          type="button"
          :title="noneLabel"
          @click="choose(undefined)"
        >
          <span class="ep-none"><i class="ep-slash" /></span>
          <span class="ep-label">{{ noneLabel }}</span>
        </button>
      </div>

      <template v-for="grp in groups" :key="grp.group">
        <div class="ep-group">{{ grp.group }}</div>
        <div class="ep-grid">
          <button
            v-for="fx in grp.effects"
            :key="fx"
            class="ep-cell"
            :class="{ sel: modelValue === fx }"
            type="button"
            :title="effectLabel(fx)"
            @click="choose(fx)"
          >
            <UiEffectTile :effect="fx" :mode="direction" />
            <span class="ep-label">{{ effectLabel(fx) }}</span>
          </button>
        </div>
      </template>

      <p v-if="empty" class="ep-empty">No effects match “{{ q }}”.</p>
    </div>
  </div>
</template>

<style scoped>
.ep {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-m);
  background: var(--bg-1);
  padding: 6px;
}
.ep-search {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: var(--radius-s);
  background: var(--bg-2);
  color: var(--text-3);
}
.ep-q {
  flex: 1;
  min-width: 0;
  border: none;
  background: none;
  color: var(--text-0);
  font-size: 12px;
  outline: none;
}
.ep-q::placeholder {
  color: var(--text-3);
}
.ep-clear {
  display: flex;
  border: none;
  background: none;
  color: var(--text-3);
  cursor: pointer;
  padding: 0;
}
.ep-clear:hover {
  color: var(--text-0);
}
.ep-scroll {
  max-height: 244px;
  overflow-y: auto;
  padding-right: 2px;
}
.ep-group {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-3);
  padding: 8px 2px 4px;
}
.ep-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
.ep-cell {
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
.ep-cell:hover {
  background: var(--bg-2);
}
.ep-cell.sel {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}
.ep-cell.sel .ep-label {
  color: var(--accent-strong);
  font-weight: 600;
}
.ep-label {
  font-size: 10px;
  color: var(--text-2);
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* "none" tile: a muted box with a diagonal strike */
.ep-none {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 16 / 10;
  border-radius: var(--radius-s);
  background: var(--bg-3);
  overflow: hidden;
}
.ep-slash {
  position: absolute;
  top: 50%;
  left: 8%;
  width: 84%;
  height: 2px;
  background: var(--text-3);
  transform: translateY(-50%) rotate(-20deg);
  transform-origin: center;
}
.ep-empty {
  padding: 12px 4px;
  margin: 0;
  font-size: 11px;
  color: var(--text-3);
  text-align: center;
}
</style>

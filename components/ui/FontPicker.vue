<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import catalog from '~/data/google-fonts.json'
import { loadGoogleFont } from '~/utils/fonts'

defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [family: string] }>()

const PAGE_SIZE = 60
const menuId = useId()
const open = ref(false)
const query = ref('')
const visibleCount = ref(PAGE_SIZE)
const trigger = ref<HTMLButtonElement>()
const menu = ref<HTMLDivElement>()
const search = ref<HTMLInputElement>()
const list = ref<HTMLDivElement>()
const position = ref({ top: '0px', left: '0px', width: '280px' })
const normalizedQuery = computed(() => query.value.trim().toLowerCase())
const matches = computed(() => catalog.families.filter((family) =>
  family.toLowerCase().includes(normalizedQuery.value)
))
const visibleFonts = computed(() => matches.value.slice(0, visibleCount.value))
const customFamily = computed(() => query.value.trim() &&
  !matches.value.some((family) => family.toLowerCase() === normalizedQuery.value)
  ? query.value.trim() : '')

watch(query, () => {
  visibleCount.value = PAGE_SIZE
  if (list.value) list.value.scrollTop = 0
})

function positionMenu() {
  if (!trigger.value) return
  const rect = trigger.value.getBoundingClientRect()
  const width = Math.min(Math.max(rect.width, 280), window.innerWidth - 16)
  const height = menu.value?.offsetHeight ?? 320
  const below = rect.bottom + 4
  position.value = {
    top: `${Math.max(8, below + height <= window.innerHeight - 8 ? below : rect.top - height - 4)}px`,
    left: `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`,
    width: `${width}px`,
  }
}

function close(restoreFocus = false) {
  open.value = false
  if (restoreFocus) trigger.value?.focus()
}

function onPointerDown(event: PointerEvent) {
  const target = event.target as Node
  if (!menu.value?.contains(target) && !trigger.value?.contains(target)) close()
}

function onFocusIn(event: FocusEvent) {
  const target = event.target as Node
  if (!menu.value?.contains(target) && !trigger.value?.contains(target)) close()
}

function removeListeners() {
  document.removeEventListener('pointerdown', onPointerDown)
  document.removeEventListener('focusin', onFocusIn)
  window.removeEventListener('resize', positionMenu)
  window.removeEventListener('scroll', positionMenu, true)
}

watch(open, async (value) => {
  if (!value) return removeListeners()
  query.value = ''
  visibleCount.value = PAGE_SIZE
  await nextTick()
  if (!open.value) return
  positionMenu()
  search.value?.focus()
  document.addEventListener('pointerdown', onPointerDown)
  document.addEventListener('focusin', onFocusIn)
  window.addEventListener('resize', positionMenu)
  window.addEventListener('scroll', positionMenu, true)
})
watch([matches, visibleCount], async () => {
  await nextTick()
  if (open.value) positionMenu()
})
onBeforeUnmount(removeListeners)

function pick(family: string) {
  loadGoogleFont(family)
  emit('update:modelValue', family)
  close(true)
}

function pickSearch() {
  const exact = matches.value.find((family) => family.toLowerCase() === normalizedQuery.value)
  const family = exact ?? matches.value[0] ?? customFamily.value
  if (family) pick(family)
}

async function showMore() {
  const firstNewIndex = visibleCount.value
  visibleCount.value += PAGE_SIZE
  await nextTick()
  list.value?.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')[firstNewIndex]?.focus()
}
</script>

<template>
  <div class="font-picker" @keydown.stop>
    <button
      ref="trigger"
      type="button"
      class="ctl font-btn"
      aria-label="Font family"
      aria-haspopup="dialog"
      :aria-expanded="open"
      :aria-controls="open ? menuId : undefined"
      @click="open = !open"
      @keydown.esc.stop.prevent="close(true)"
    >
      <span :style="{ fontFamily: `'${modelValue}'` }">{{ modelValue }}</span>
      <UiIcon name="chevron_down" :size="11" />
    </button>
    <Teleport to="body">
      <div
        v-if="open"
        :id="menuId"
        ref="menu"
        class="font-menu"
        :style="position"
        role="dialog"
        aria-label="Choose Google font"
        @keydown.stop
        @keydown.esc.stop.prevent="close(true)"
      >
        <input
          ref="search"
          v-model="query"
          class="ctl"
          placeholder="Search all Google Fonts…"
          aria-label="Search Google Fonts"
          @keydown.enter.stop.prevent="pickSearch"
          @keydown.down.stop.prevent="list?.querySelector<HTMLButtonElement>('button')?.focus()"
        />
        <p class="font-count" role="status">{{ matches.length.toLocaleString() }} fonts</p>
        <div ref="list" class="font-list">
          <button
            v-for="family in visibleFonts"
            :key="family"
            type="button"
            class="font-item"
            :aria-pressed="family === modelValue"
            @click="pick(family)"
          >{{ family }}</button>
          <button
            v-if="visibleCount < matches.length"
            type="button"
            class="font-item more"
            @click="showMore"
          >Show more fonts ({{ matches.length - visibleCount }} remaining)</button>
          <p v-if="!matches.length" class="font-empty">No matching fonts in the catalog.</p>
          <button v-if="customFamily" type="button" class="font-item custom" @click="pick(customFamily)">
            Use “{{ customFamily }}”
          </button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.font-picker { width: 100%; min-width: 0; }
.font-btn {
  width: 100%; display: flex; align-items: center; justify-content: space-between;
  gap: 6px; cursor: pointer;
}
.font-btn span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.font-menu {
  position: fixed; z-index: 1100; padding: 6px;
  background: var(--bg-3); border: 1px solid var(--border-1);
  border-radius: var(--radius-m); box-shadow: var(--shadow-2);
  max-height: calc(100vh - 16px); overflow-y: auto;
}
.font-menu > input { width: 100%; }
.font-count { margin: 6px 8px; color: var(--text-2); font-size: 11px; }
.font-list { max-height: 220px; overflow-y: auto; }
.font-item {
  display: block; width: 100%; padding: 5px 8px; border: none; background: none;
  color: var(--text-0); font-size: 12px; text-align: left; border-radius: var(--radius-s);
}
.font-item:hover, .font-item:focus-visible { background: var(--bg-4); }
.font-item[aria-pressed='true'] { background: var(--accent-soft); color: var(--accent-strong); }
.font-item.custom, .font-item.more { color: var(--accent-strong); font-size: 11px; }
.font-empty { margin: 8px; color: var(--text-2); font-size: 12px; }
</style>

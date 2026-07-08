import { ref, computed, watch, nextTick, type Ref } from 'vue'

/**
 * Shared behaviour for the visual gallery pickers (EffectPicker / AnimPicker):
 * turns a list of filtered groups into a single flat index space and drives an
 * accessible **listbox with roving tabindex** — one tab stop, arrow/Home/End
 * navigation, and a leading optional "None" cell. Selection is manual
 * (Enter/Space/click), so arrowing only moves focus.
 *
 * Class-agnostic: it addresses cells by `[data-idx]` and finds the selected
 * cell by `[aria-selected="true"]`, so each picker keeps its own markup/styles.
 */
export interface GalleryItem {
  /** the value emitted when this cell is chosen (an effect/preset id) */
  value: string
  label: string
}
export interface GalleryGroup {
  group: string
  items: GalleryItem[]
}

export interface UseGalleryListOptions {
  /** already filtered + grouped items (excluding the None cell) */
  groups: () => GalleryGroup[]
  /** whether a leading "None" cell (value undefined) is present */
  allowNone: () => boolean
  /** the current model value (undefined ≈ None) */
  selected: () => string | undefined
  /** called when a cell is chosen */
  onSelect: (value: string | undefined) => void
}

export function useGalleryList(opts: UseGalleryListOptions) {
  /** flat index space: None (if allowed) first, then each group in order */
  const indexed = computed(() => {
    const groups: {
      group: string
      items: { value: string; label: string; index: number }[]
    }[] = []
    const flat: (string | undefined)[] = []
    let i = 0
    const noneIndex = opts.allowNone() ? (flat.push(undefined), i++) : -1
    for (const g of opts.groups()) {
      const items = g.items.map((it) => {
        flat.push(it.value)
        return { ...it, index: i++ }
      })
      if (items.length) groups.push({ group: g.group, items })
    }
    return { noneIndex, groups, flat, count: i }
  })
  const empty = computed(() => indexed.value.groups.length === 0)

  /** flat index of the current selection (for roving focus + scroll-into-view) */
  const selectedIndex = computed(() => {
    const at = indexed.value.flat.findIndex((v) => v === opts.selected())
    if (at >= 0) return at
    return indexed.value.noneIndex >= 0 ? indexed.value.noneIndex : 0
  })

  /** roving tabindex: exactly one cell is tabbable at a time */
  const activeIndex = ref(0)
  watch(
    () => indexed.value.count,
    (n) => {
      if (activeIndex.value >= n) activeIndex.value = Math.max(0, n - 1)
    }
  )

  const scrollEl: Ref<HTMLElement | undefined> = ref()
  function focusIndex(i: number) {
    nextTick(() => {
      scrollEl.value?.querySelector<HTMLElement>(`[data-idx="${i}"]`)?.focus()
    })
  }
  function scrollSelectedIntoView() {
    nextTick(() => {
      scrollEl.value
        ?.querySelector('[aria-selected="true"]')
        ?.scrollIntoView({ block: 'nearest' })
    })
  }
  function choose(value: string | undefined, index: number) {
    activeIndex.value = index
    opts.onSelect(value)
  }
  function onKey(e: KeyboardEvent) {
    const n = indexed.value.count
    if (!n) return
    let i = activeIndex.value
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        i = (i + 1) % n
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        i = (i - 1 + n) % n
        break
      case 'Home':
        i = 0
        break
      case 'End':
        i = n - 1
        break
      default:
        return
    }
    e.preventDefault()
    activeIndex.value = i
    focusIndex(i)
    // Enter/Space still select the focused cell via its native button click
  }

  // Re-sync the roving tab stop + scroll the selection into view on first
  // mount AND whenever the selection changes — including when the picker is
  // reused in place for a different element (e.g. switching layers keeps the
  // AnimPicker mounted and only flips its props). choose() already sets
  // activeIndex before emitting, so a user pick is a harmless no-op here.
  watch(
    selectedIndex,
    (i) => {
      activeIndex.value = i
      scrollSelectedIntoView()
    },
    { immediate: true, flush: 'post' }
  )

  return { indexed, empty, activeIndex, scrollEl, choose, onKey }
}

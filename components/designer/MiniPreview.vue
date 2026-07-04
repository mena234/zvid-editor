<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { DesignDoc } from '~/utils/designer/types'
import { compileDesign } from '~/utils/designer/compile'
import { loadGoogleFont } from '~/utils/fonts'

/**
 * Tiny paused thumbnail of a design (template gallery). Shadow DOM keeps
 * the per-template `.dz-*` css from colliding; animations are frozen at a
 * representative moment so entrance presets don't leave thumbnails blank.
 * Fits its container width (or an explicit `width` prop).
 */
const props = defineProps<{ design: DesignDoc; width?: number }>()

const host = ref<HTMLElement>()
const wrap = ref<HTMLElement>()
const compiled = computed(() => compileDesign(props.design))
const measured = ref(props.width ?? 148)
let ro: ResizeObserver | null = null

const w = computed(() => props.width ?? measured.value)
const scale = computed(() => w.value / props.design.width)
const h = computed(() => Math.round(props.design.height * scale.value))

function build() {
  const el = host.value
  if (!el) return
  loadGoogleFont(props.design.fontFamily)
  const shadow = el.shadowRoot ?? el.attachShadow({ mode: 'open' })
  shadow.innerHTML = `<style>${compiled.value.css}</style>${compiled.value.html}`
  const root = shadow.querySelector('.dz') as HTMLElement | null
  if (!root) return
  // freeze mid-loop so entrances have already landed
  const at = Math.min(compiled.value.duration * 0.6, compiled.value.duration - 0.01) * 1000
  for (const a of root.getAnimations({ subtree: true })) {
    a.pause()
    try {
      a.currentTime = at
    } catch {
      /* ignore */
    }
  }
}

onMounted(() => {
  if (!props.width && wrap.value) {
    ro = new ResizeObserver(() => {
      const cw = wrap.value?.clientWidth ?? 0
      if (cw > 0) measured.value = cw
    })
    ro.observe(wrap.value)
    measured.value = wrap.value.clientWidth || measured.value
  }
  build()
})
onBeforeUnmount(() => ro?.disconnect())
watch(compiled, () => build())
</script>

<template>
  <span ref="wrap" class="mini" :style="{ width: width ? `${w}px` : '100%', height: `${h}px` }">
    <span
      ref="host"
      class="mini-host"
      :style="{
        width: `${design.width}px`,
        height: `${design.height}px`,
        transform: `scale(${scale})`,
        fontFamily: `'${design.fontFamily}', sans-serif`,
      }"
    />
  </span>
</template>

<style scoped>
.mini {
  display: block;
  position: relative;
  overflow: hidden;
  border-radius: var(--radius-s);
  background: repeating-conic-gradient(var(--checker-a) 0 25%, var(--checker-b) 0 50%) 0 0 /
    12px 12px;
  pointer-events: none;
}
.mini-host {
  display: block;
  transform-origin: 0 0;
}
</style>

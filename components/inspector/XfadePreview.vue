<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import {
  xfadeFrame,
  layerStyle,
  plateStyle,
  isApproximateEffect,
  deviceScale,
  type XfadeFrameCss,
} from '~/utils/xfade'

const props = defineProps<{
  effect: string
  /** omit for a two-stream transition preview */
  direction?: 'enter' | 'exit' | 'transition'
}>()

const mode = computed(() =>
  props.direction === 'enter' || props.direction === 'exit'
    ? props.direction
    : ('transition' as const)
)

const box = ref<HTMLElement>()
const size = ref({ w: 160, h: 54 })
let ro: ResizeObserver | null = null

const frame = ref<XfadeFrameCss>({ a: {}, b: {} })
let raf = 0
let start = 0

function loop(ts: number) {
  if (!start) start = ts
  const cycle = 1800
  const p = Math.min(1, ((ts - start) % cycle) / (cycle * 0.7)) // hold at 1
  // pixelize's block size scales with min(canvas) — at thumbnail size the
  // faithful peak is only 4px, unreadable. Boost the virtual canvas 3× so
  // the thumbnail communicates the mosaic (block size is the ONLY
  // canvas-dependent term pixelize uses; the stage stays exact).
  const boost = props.effect === 'pixelize' ? 3 : 1
  frame.value = xfadeFrame(props.effect, p, {
    mode: mode.value,
    canvasW: size.value.w * boost,
    canvasH: size.value.h * boost,
    contentOpaque: true,
    // the element itself is unscaled — device px per filter user px = dpr
    rasterScale: deviceScale(1),
  })
  raf = requestAnimationFrame(loop)
}

onMounted(() => {
  ro = new ResizeObserver(() => {
    if (box.value)
      size.value = { w: box.value.clientWidth, h: box.value.clientHeight }
  })
  if (box.value) {
    ro.observe(box.value)
    size.value = { w: box.value.clientWidth, h: box.value.clientHeight }
  }
  raf = requestAnimationFrame(loop)
})
onBeforeUnmount(() => {
  ro?.disconnect()
  cancelAnimationFrame(raf)
})
watch(
  () => [props.effect, props.direction],
  () => (start = 0)
)
</script>

<template>
  <div ref="box" class="xf-preview" :title="effect">
    <!-- stack order mirrors the xfade composite: plate, stream A, stream B -->
    <div v-if="frame.plate" class="xf-plate" :style="plateStyle(frame.plate)" />
    <div v-if="mode !== 'enter'" class="xf-tile tile-a" :style="layerStyle(frame.a)">
      <span>Aa</span>
    </div>
    <div v-if="mode !== 'exit'" class="xf-tile tile-b" :style="layerStyle(frame.b)">
      <span>{{ mode === 'transition' ? 'Bb' : 'Aa' }}</span>
    </div>
    <span
      v-if="isApproximateEffect(effect)"
      class="approx"
      title="Approximate preview — the final render uses FFmpeg xfade"
      >≈</span
    >
  </div>
</template>

<style scoped>
.xf-preview {
  position: relative;
  width: 100%;
  height: 80px;
  border-radius: var(--radius-s);
  background:
    linear-gradient(45deg, var(--bg-3) 25%, transparent 25%),
    linear-gradient(-45deg, var(--bg-3) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, var(--bg-3) 75%),
    linear-gradient(-45deg, transparent 75%, var(--bg-3) 75%);
  background-size: 12px 12px;
  background-color: var(--bg-1);
  overflow: hidden;
  border: 1px solid var(--border-1);
}
.xf-plate,
.xf-tile {
  position: absolute;
  inset: 0;
}
.xf-tile {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 800;
  font-size: 16px;
}
/* high-frequency patterns so blur / mosaic / zoom / dissolve are visible */
/* stripes finer than pixelize's peak block (min(w,h)/20) so mosaic,
   blur, zoom, and dissolve all visibly rework the pattern */
.tile-a {
  background: repeating-linear-gradient(45deg, #7c8aa0 0 3px, #2c3a4e 3px 6px);
}
.tile-b {
  background: repeating-linear-gradient(
    45deg,
    color-mix(in srgb, var(--accent) 80%, #fff) 0 3px,
    color-mix(in srgb, var(--accent-2) 60%, #000) 3px 6px
  );
}
.approx {
  position: absolute;
  top: 2px;
  right: 5px;
  color: var(--yellow);
  font-size: 12px;
  font-weight: 700;
}
</style>

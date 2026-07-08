<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, inject } from 'vue'
import {
  xfadeFrame,
  layerStyle,
  plateStyle,
  isApproximateEffect,
  deviceScale,
  type XfadeFrameCss,
  type XfadeMode,
} from '~/utils/xfade'
import { EFFECT_CLOCK } from '~/utils/effectMeta'

/**
 * One xfade thumbnail. Reuses the exact vf_xfade.c DOM realization from
 * utils/xfade — this component only drives it. At rest it shows a legible
 * mid-transition still; on hover it plays the effect from the shared clock
 * (VEED/Vmaker-style hover preview), so only the tile under the pointer costs
 * anything.
 */
const props = defineProps<{
  effect: string
  mode: XfadeMode
}>()

/** shared progress 0→1 provided by the parent picker (only advances while the
 *  pointer is in the gallery); 0.5 fallback = a representative still */
const clock = inject(EFFECT_CLOCK, ref(0.5))

const box = ref<HTMLElement>()
const size = ref({ w: 120, h: 72 })
const hovered = ref(false)
let ro: ResizeObserver | null = null

/**
 * Progress shown at rest (not hovered). 0.5 is a legible mid-transition still
 * for almost every effect — but it is the exact fully-collapsed, all-black
 * midpoint of circlecrop / rectcrop. There the visible stream flips at 0.5 and
 * each mode only renders one of the two streams, so bias the crop family off
 * the midpoint toward the side its rendered stream is open on.
 */
const restP = computed(() => {
  if (props.effect === 'circlecrop' || props.effect === 'rectcrop') {
    // near the ends the keyhole is wide open (legible); at 0.5 it is fully
    // collapsed to black. enter renders stream B, exit/transition stream A —
    // pick the side where that stream is the one showing through the hole.
    return props.mode === 'enter' ? 0.85 : 0.15
  }
  return 0.5
})

const frame = computed<XfadeFrameCss>(() => {
  const p = hovered.value ? clock.value : restP.value
  // pixelize's block size scales with min(canvas); at thumbnail size the
  // faithful peak is only a few px. Boost the virtual canvas so the mosaic
  // reads (block size is the only canvas-dependent term pixelize uses).
  const boost = props.effect === 'pixelize' ? 3 : 1
  return xfadeFrame(props.effect, p, {
    mode: props.mode,
    canvasW: size.value.w * boost,
    canvasH: size.value.h * boost,
    contentOpaque: true,
    rasterScale: deviceScale(1),
  })
})

onMounted(() => {
  if (!box.value) return
  ro = new ResizeObserver(() => {
    if (box.value)
      size.value = { w: box.value.clientWidth, h: box.value.clientHeight }
  })
  ro.observe(box.value)
  size.value = { w: box.value.clientWidth, h: box.value.clientHeight }
})
onBeforeUnmount(() => ro?.disconnect())
</script>

<template>
  <div
    ref="box"
    class="xf-tile-box"
    :title="effect"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
  >
    <!-- stack order mirrors the xfade composite: plate, stream A, stream B -->
    <div v-if="frame.plate" class="xf-plate" :style="plateStyle(frame.plate)" />
    <div v-if="mode !== 'enter'" class="xf-stream a" :style="layerStyle(frame.a)">
      <span>Aa</span>
    </div>
    <div v-if="mode !== 'exit'" class="xf-stream b" :style="layerStyle(frame.b)">
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
.xf-tile-box {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 10;
  border-radius: var(--radius-s);
  /* checkerboard so transparency (fades/wipes) reads against the backdrop */
  background:
    linear-gradient(45deg, var(--bg-3) 25%, transparent 25%),
    linear-gradient(-45deg, var(--bg-3) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, var(--bg-3) 75%),
    linear-gradient(-45deg, transparent 75%, var(--bg-3) 75%);
  background-size: 10px 10px;
  background-color: var(--bg-1);
  overflow: hidden;
}
.xf-plate,
.xf-stream {
  position: absolute;
  inset: 0;
}
.xf-stream {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 800;
  font-size: 15px;
  letter-spacing: 0.02em;
}
/* high-frequency stripes so blur / mosaic / zoom / dissolve stay visible */
.xf-stream.a {
  background: repeating-linear-gradient(45deg, #7c8aa0 0 3px, #2c3a4e 3px 6px);
}
.xf-stream.b {
  background: repeating-linear-gradient(
    45deg,
    color-mix(in srgb, var(--accent) 80%, #fff) 0 3px,
    color-mix(in srgb, var(--accent-2) 60%, #000) 3px 6px
  );
}
.approx {
  position: absolute;
  top: 1px;
  right: 4px;
  color: var(--yellow);
  font-size: 11px;
  font-weight: 700;
  text-shadow: 0 0 2px #000;
}
</style>

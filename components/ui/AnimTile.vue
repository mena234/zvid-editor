<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { compileDesign } from '~/utils/designer/compile'
import {
  makeDesign,
  makeTextLayer,
  makeShapeLayer,
  makeImageLayer,
  type DesignLayer,
  type LayerAnim,
} from '~/utils/designer/types'
import { ANIM_PRESETS } from '~/utils/designer/animations'

/**
 * One Design-Studio animation thumbnail. Builds a tiny one-layer sample design
 * for this preset, compiles it with the SAME `compileDesign` pipeline the
 * studio/render use, renders it in an isolated Shadow DOM, and drives its CSS
 * animations through the Web Animations API — so the thumbnail plays exactly
 * what will render. At rest it holds the settled frame; it plays on hover
 * (only the hovered tile runs a rAF). Built lazily when scrolled into view.
 */
const props = defineProps<{
  presetId: string
  kind: 'text' | 'shape' | 'image'
}>()

const DES_W = 200
const DES_H = 125

/* a small self-contained "photo" so image presets have something to move */
const SAMPLE_IMG =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='132' height='84'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%238b5cf6'/%3E%3Cstop offset='1' stop-color='%23e879f9'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='132' height='84' fill='url(%23g)'/%3E%3Ccircle cx='40' cy='30' r='13' fill='white' fill-opacity='0.9'/%3E%3Cpath d='M0 84 L46 44 L76 66 L132 26 L132 84 Z' fill='white' fill-opacity='0.45'/%3E%3C/svg%3E"

function sampleLayer(): DesignLayer {
  const def = ANIM_PRESETS[props.presetId]
  const anim: LayerAnim | null = def
    ? {
        preset: props.presetId,
        duration: def.defaults.duration,
        delay: 0,
        stagger: def.defaults.stagger ?? 0.06,
        easing: 'smooth',
        dir: 'up',
      }
    : null
  if (props.kind === 'text')
    return makeTextLayer({
      text: 'Ag',
      fontSize: 72,
      fontWeight: '800',
      lineHeight: 1,
      fill: { kind: 'gradient', from: '#ffffff', to: '#c9b6ff', angle: 90 },
      anim,
    })
  if (props.kind === 'shape')
    return makeShapeLayer({
      shape: 'rect',
      width: 120,
      height: 80,
      radius: 16,
      fill: { kind: 'gradient', from: '#8b5cf6', to: '#e879f9', angle: 135 },
      anim,
    })
  return makeImageLayer({ src: SAMPLE_IMG, width: 132, height: 84, radius: 10, anim })
}

const box = ref<HTMLElement>()
const host = ref<HTMLElement>()
const scale = ref(DES_W ? 0.4 : 1)
const stageStyle = computed(() => ({
  width: `${DES_W}px`,
  height: `${DES_H}px`,
  transform: `scale(${scale.value})`,
  transformOrigin: '0 0',
}))

let anims: Animation[] = []
let loopMs = 1500
let restMs = 1500
let built = false
let ro: ResizeObserver | null = null
let io: IntersectionObserver | null = null
let raf = 0
let startTs = 0

function build() {
  if (built || !host.value) return
  const design = makeDesign({
    width: DES_W,
    height: DES_H,
    duration: 'auto',
    background: { kind: 'none', color: '', from: '', to: '', angle: 0, radius: 0 },
    layers: [sampleLayer()],
  })
  const compiled = compileDesign(design)
  const shadow = host.value.shadowRoot ?? host.value.attachShadow({ mode: 'open' })
  shadow.innerHTML = `<style>${compiled.css}</style>${compiled.html}`
  const root = shadow.querySelector('.dz') as (Element & { getAnimations?: any }) | null
  anims = root?.getAnimations ? root.getAnimations({ subtree: true }) : []
  for (const a of anims) a.pause()
  loopMs = Math.max(0.8, compiled.duration) * 1000
  restMs = loopMs // held end frame: entrance settled / loop start pose
  built = true
  seek(restMs)
}

function seek(ms: number) {
  for (const a of anims) {
    try {
      a.currentTime = ms
    } catch {
      /* detached animation — ignored */
    }
  }
}

function play(now: number) {
  raf = requestAnimationFrame(play)
  if (!startTs) startTs = now
  seek((now - startTs) % loopMs)
}
function onEnter() {
  if (!built) build()
  startTs = 0
  if (!raf) raf = requestAnimationFrame(play)
}
function onLeave() {
  if (raf) {
    cancelAnimationFrame(raf)
    raf = 0
  }
  seek(restMs)
}

onMounted(() => {
  if (!box.value) return
  ro = new ResizeObserver(() => {
    if (box.value) scale.value = box.value.clientWidth / DES_W
  })
  ro.observe(box.value)
  scale.value = box.value.clientWidth / DES_W
  // build lazily the first time this tile scrolls near the gallery viewport
  const root = box.value.closest('.ap-scroll')
  io = new IntersectionObserver(
    (entries) => {
      if (entries[0]?.isIntersecting) {
        build()
        io?.disconnect()
        io = null
      }
    },
    { root, rootMargin: '140px', threshold: 0 }
  )
  io.observe(box.value)
})
onBeforeUnmount(() => {
  if (raf) cancelAnimationFrame(raf)
  ro?.disconnect()
  io?.disconnect()
})
</script>

<template>
  <div ref="box" class="ap-media" @mouseenter="onEnter" @mouseleave="onLeave">
    <div ref="host" class="ap-stage" :style="stageStyle" />
  </div>
</template>

<style scoped>
.ap-media {
  position: relative;
  width: 100%;
  aspect-ratio: 200 / 125;
  border-radius: var(--radius-s);
  overflow: hidden;
  /* fixed dark preview surface so light/gradient sample content reads in both
     app themes (like a video thumbnail) */
  background: #171a2e;
}
.ap-stage {
  position: absolute;
  top: 0;
  left: 0;
}
</style>

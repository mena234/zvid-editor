<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, nextTick } from 'vue'
import { useTourStore } from '~/stores/tour'

/**
 * Spotlight walkthrough over the live UI. Targets are located by their
 * data-tour attribute; the scrim is one element whose spotlight "hole" is a
 * huge box-shadow, so moving between steps animates for free via CSS
 * transitions on the hole's box.
 */
const tour = useTourStore()

const PAD = 6 // breathing room around the spotlit element
const CARD_W = 330
const GAP = 14 // card ↔ spotlight distance

type Rect = { top: number; left: number; width: number; height: number }
const rect = ref<Rect | null>(null)

function measure() {
  const step = tour.current
  if (!step?.target) {
    rect.value = null
    return
  }
  const el = document.querySelector(`[data-tour="${step.target}"]`)
  if (!el) {
    rect.value = null
    return
  }
  const r = el.getBoundingClientRect()
  rect.value = { top: r.top, left: r.left, width: r.width, height: r.height }
}

// re-measure after the step's side-effects (panel opening, etc.) have painted
watch(
  () => [tour.active, tour.stepIndex],
  async () => {
    if (!tour.active) return
    await nextTick()
    measure()
    // panel width/layout transitions settle a beat later
    setTimeout(measure, 120)
    setTimeout(measure, 320)
  },
  { immediate: true }
)

let poll = 0
function onResize() {
  if (tour.active) measure()
}
function onKey(e: KeyboardEvent) {
  if (!tour.active) return
  e.stopPropagation()
  if (e.key === 'Escape') tour.finish()
  else if (e.key === 'ArrowRight' || e.key === 'Enter') tour.next()
  else if (e.key === 'ArrowLeft') tour.prev()
}
onMounted(() => {
  tour.maybeAutoStart()
  window.addEventListener('resize', onResize)
  // capture phase so the editor's global shortcuts never see tour keys
  window.addEventListener('keydown', onKey, true)
  // layout can shift without a resize (fonts, async panels) — cheap safety net
  poll = window.setInterval(onResize, 400)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  window.removeEventListener('keydown', onKey, true)
  window.clearInterval(poll)
})

const spot = computed(() => {
  if (!rect.value) return null
  return {
    top: rect.value.top - PAD,
    left: rect.value.left - PAD,
    width: rect.value.width + PAD * 2,
    height: rect.value.height + PAD * 2,
  }
})

const spotStyle = computed(() =>
  spot.value
    ? {
        top: `${spot.value.top}px`,
        left: `${spot.value.left}px`,
        width: `${spot.value.width}px`,
        height: `${spot.value.height}px`,
      }
    : undefined
)

/** Card position for the current placement, clamped to the viewport. */
const cardStyle = computed(() => {
  const step = tour.current
  if (!step) return undefined
  const vw = window.innerWidth
  const vh = window.innerHeight
  const s = spot.value
  const placement = s ? step.placement : 'center'

  let top = vh / 2
  let left = vw / 2
  let translate = '-50%, -50%'

  if (s) {
    const cx = s.left + s.width / 2
    const cy = s.top + s.height / 2
    switch (placement) {
      case 'right':
        top = cy
        left = s.left + s.width + GAP
        translate = '0, -50%'
        break
      case 'left':
        top = cy
        left = s.left - GAP - CARD_W
        translate = '0, -50%'
        break
      case 'bottom':
        top = s.top + s.height + GAP
        left = cx - CARD_W / 2
        translate = '0, 0'
        break
      case 'top':
        top = s.top - GAP
        left = cx - CARD_W / 2
        translate = '0, -100%'
        break
      case 'over':
      case 'center':
        top = cy
        left = cx
        translate = '-50%, -50%'
        break
    }
    // keep the card on screen whatever the layout does
    left = Math.min(Math.max(8, left), vw - (translate.startsWith('-50%') ? CARD_W / 2 + 8 : CARD_W + 8))
    top = Math.min(Math.max(8, top), vh - 8)
  }

  return {
    top: `${top}px`,
    left: `${left}px`,
    transform: `translate(${translate})`,
    width: `${CARD_W}px`,
  }
})
</script>

<template>
  <Teleport to="body">
    <div v-if="tour.active && tour.current" class="tour" role="dialog" aria-modal="true" :aria-label="tour.current.title">
      <!-- scrim: either a spotlight hole over the target, or a plain backdrop -->
      <div v-if="spot" class="spotlight" :style="spotStyle" />
      <div v-else class="backdrop" />

      <div :key="tour.current.id" class="card" :style="cardStyle">
        <div class="meta">Step {{ tour.stepIndex + 1 }} of {{ tour.steps.length }}</div>
        <h3>{{ tour.current.title }}</h3>
        <p>{{ tour.current.body }}</p>
        <div class="dots" aria-hidden="true">
          <i
            v-for="(s, i) in tour.steps"
            :key="s.id"
            :class="{ on: i === tour.stepIndex, past: i < tour.stepIndex }"
          />
        </div>
        <div class="row">
          <button class="btn ghost" @click="tour.finish()">Skip tour</button>
          <span class="grow" />
          <button v-if="tour.stepIndex > 0" class="btn" @click="tour.prev()">Back</button>
          <button class="btn primary" @click="tour.next()">
            {{ tour.isLast ? 'Start editing' : 'Next' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.tour {
  position: fixed;
  inset: 0;
  z-index: 300;
}
.backdrop {
  position: absolute;
  inset: 0;
  background: var(--scrim);
  backdrop-filter: blur(2px);
}
.spotlight {
  position: fixed;
  border-radius: 12px;
  /* the scrim is the shadow — the hole itself stays clear */
  box-shadow:
    0 0 0 2px var(--accent),
    0 0 0 200vmax var(--scrim);
  transition:
    top 0.28s cubic-bezier(0.4, 0, 0.2, 1),
    left 0.28s cubic-bezier(0.4, 0, 0.2, 1),
    width 0.28s cubic-bezier(0.4, 0, 0.2, 1),
    height 0.28s cubic-bezier(0.4, 0, 0.2, 1);
}
.card {
  position: fixed;
  padding: 16px 18px 14px;
  background: var(--bg-1);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-l);
  box-shadow: var(--shadow-2);
  /* keyed by step id, so this replays on every step change */
  animation: tour-card-in 0.18s ease;
}
@keyframes tour-card-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
.meta {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--accent);
  margin-bottom: 6px;
}
h3 {
  margin: 0 0 6px;
  font-size: 15px;
  font-weight: 700;
  color: var(--text-0);
}
p {
  margin: 0 0 12px;
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--text-1);
}
.dots {
  display: flex;
  gap: 5px;
  margin-bottom: 12px;
}
.dots i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--border-2);
  transition: background 0.15s;
}
.dots i.past {
  background: color-mix(in srgb, var(--accent) 45%, transparent);
}
.dots i.on {
  background: var(--accent);
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.grow {
  flex: 1;
}
</style>

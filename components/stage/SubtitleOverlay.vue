<script setup lang="ts">
import { computed, watch } from 'vue'
import { useProjectStore } from '~/stores/project'
import {
  activeCaptionAt,
  renderCaptionWords,
  subtitleContainerStyle,
  subtitleTextStyle,
  subtitleStrokeStyle,
  type RenderedWord,
} from '~/utils/subtitleRuntime'
import { loadGoogleFont } from '~/utils/fonts'

const props = defineProps<{ time: number }>()
const project = useProjectStore()

// resolvedPreviewDoc substitutes {{placeholders}} in caption text/styles
// (identical to project.doc when the variables preview is off)
const subtitle = computed(() => project.resolvedPreviewDoc.subtitle)
const styles = computed(() => subtitle.value?.styles ?? {})
const mode = computed(() => styles.value.mode ?? 'normal')

watch(
  () => styles.value.fontFamily,
  (f) => f && loadGoogleFont(f),
  { immediate: true }
)

const active = computed(() => activeCaptionAt(subtitle.value, props.time))

const words = computed(() => {
  if (!active.value) return []
  return renderCaptionWords(active.value.caption, props.time, mode.value, styles.value)
})

const containerStyle = computed(() =>
  subtitleContainerStyle(styles.value, project.defaults.width, project.defaults.height)
)
const textStyle = computed(() => subtitleTextStyle(styles.value))
// stroke layer behind the fills — mirrors libass outline rendering order
const strokeStyle = computed(() => subtitleStrokeStyle(styles.value))
const activeColor = computed(() => styles.value.activeWord?.color)
// The renderer's Highlight ASS style carries the activeWord.background box in
// every mode that restyles the active word via {\rHighlight}.
const activeBackground = computed(() =>
  ['progressive', 'karaoke', 'highlight', 'pop', 'bounce'].includes(mode.value)
    ? styles.value.activeWord?.background
    : undefined
)

function wordStyle(w: RenderedWord): Record<string, string> | undefined {
  const s: Record<string, string> = {}
  if (w.active && activeColor.value) s.color = activeColor.value
  if (w.active && activeBackground.value) {
    s.background = activeBackground.value
    // renderer active-word boxes are square unless activeWord.radius is set
    s.borderRadius = `${Number(styles.value.activeWord?.radius) || 0}px`
    s.padding = '0 0.14em'
  }
  if (w.opacity !== undefined) s.opacity = String(w.opacity)
  if (w.scale !== undefined) {
    s.display = 'inline-block'
    s.transform = `scale(${w.scale})`
  }
  if (w.translate !== undefined) {
    s.display = 'inline-block'
    s.transform = `translate(${w.translate[0]}px, ${w.translate[1]}px)`
  }
  return Object.keys(s).length ? s : undefined
}

/**
 * Word style for the stroke layer: keeps every layout-affecting property of
 * the fill layer (opacity, transforms, active-word padding) so both layers
 * wrap and align identically, but never any color/box.
 */
function strokeWordStyle(w: RenderedWord): Record<string, string> | undefined {
  const s: Record<string, string> = {}
  if (w.active && activeBackground.value) s.padding = '0 0.14em'
  if (w.opacity !== undefined) s.opacity = String(w.opacity)
  if (w.scale !== undefined) {
    s.display = 'inline-block'
    s.transform = `scale(${w.scale})`
  }
  if (w.translate !== undefined) {
    s.display = 'inline-block'
    s.transform = `translate(${w.translate[0]}px, ${w.translate[1]}px)`
  }
  return Object.keys(s).length ? s : undefined
}

function typedPart(w: RenderedWord): string {
  return [...w.text].slice(0, w.revealedChars ?? 0).join('')
}
function untypedPart(w: RenderedWord): string {
  return [...w.text].slice(w.revealedChars ?? 0).join('')
}
</script>

<template>
  <div v-if="active" class="subtitle-overlay" :style="containerStyle">
    <div class="subtitle-text" :style="textStyle">
      <div class="line-stack">
        <!-- stroke layer: whole line dilated behind every fill, like libass -->
        <div v-if="strokeStyle" class="stroke-layer" aria-hidden="true" :style="strokeStyle">
          <template v-for="(w, i) in words" :key="`s${i}`">
            <span v-if="w.visible && w.revealedChars !== undefined" class="w"
              >{{ typedPart(w) }}<span class="untyped">{{ untypedPart(w) }}</span></span
            ><span v-else-if="w.visible" class="w" :style="strokeWordStyle(w)">{{
              w.text
            }}</span
            >{{ ' ' }}
          </template>
        </div>
        <div class="fill-layer">
          <template v-for="(w, i) in words" :key="i">
            <span
              v-if="w.visible && w.fillProgress !== undefined"
              class="w fill-w"
              ><span
                class="fill-top"
                aria-hidden="true"
                :style="{
                  width: `${w.fillProgress * 100}%`,
                  color: activeColor ?? 'inherit',
                }"
                >{{ w.text }}</span
              >{{ w.text }}</span
            ><span v-else-if="w.visible && w.revealedChars !== undefined" class="w"
              >{{ typedPart(w) }}<span class="untyped">{{ untypedPart(w) }}</span></span
            ><span v-else-if="w.visible" class="w" :style="wordStyle(w)">{{
              w.text
            }}</span
            >{{ ' ' }}
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.subtitle-overlay {
  z-index: 998;
}
.subtitle-text {
  max-width: 100%;
}
.line-stack {
  position: relative;
}
.stroke-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.fill-layer {
  position: relative;
}
.w {
  transition: color 0.05s linear;
}
.fill-w {
  position: relative;
}
.fill-top {
  position: absolute;
  left: 0;
  top: 0;
  overflow: hidden;
  white-space: nowrap;
  pointer-events: none;
}
/* typewriter: untyped characters keep their space (matches ASS \k reveal) */
.untyped {
  visibility: hidden;
}
</style>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { useProjectStore } from '~/stores/project'
import {
  activeCaptionAt,
  renderCaptionWords,
  subtitleContainerStyle,
  subtitleTextStyle,
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
  return renderCaptionWords(active.value.caption, props.time, mode.value)
})

const containerStyle = computed(() =>
  subtitleContainerStyle(styles.value, project.defaults.width, project.defaults.height)
)
const textStyle = computed(() => subtitleTextStyle(styles.value))
const activeColor = computed(() => styles.value.activeWord?.color)
</script>

<template>
  <div v-if="active" class="subtitle-overlay" :style="containerStyle">
    <div class="subtitle-text" :style="textStyle">
      <template v-for="(w, i) in words" :key="i">
        <span
          v-if="w.visible"
          class="w"
          :style="w.active && activeColor ? { color: activeColor } : undefined"
          >{{ w.text }}</span
        >{{ ' ' }}
      </template>
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
.w {
  transition: color 0.05s linear;
}
</style>

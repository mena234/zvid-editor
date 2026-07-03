<script setup lang="ts">
import { computed } from 'vue'
import type { VisualDoc } from '~/shared/schema/types'
import { useProjectStore } from '~/stores/project'

const props = defineProps<{ item: VisualDoc }>()
const project = useProjectStore()

function patch(p: Record<string, any>) {
  project.patchVisual(props.item._id, p)
}

const svgValid = computed(() => {
  try {
    const doc = new DOMParser().parseFromString(props.item.svg ?? '', 'image/svg+xml')
    return (
      doc.documentElement.tagName.toLowerCase() === 'svg' &&
      !doc.querySelector('parsererror')
    )
  } catch {
    return false
  }
})
</script>

<template>
  <UiSection title="SVG markup">
    <textarea
      class="ctl mono code"
      rows="10"
      :value="item.svg ?? ''"
      spellcheck="false"
      placeholder='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">…</svg>'
      @change="patch({ svg: ($event.target as HTMLTextAreaElement).value })"
    />
    <p class="hint" :class="{ err: !svgValid }">
      <template v-if="svgValid">✓ valid SVG — rendered live on the stage</template>
      <template v-else>✗ markup does not parse as SVG</template>
    </p>
    <div class="preview checkerboard">
      <div class="preview-inner" v-html="item.svg" />
    </div>
  </UiSection>
</template>

<style scoped>
.code {
  font-size: 10.5px;
  line-height: 1.5;
}
.err {
  color: var(--red);
}
.preview {
  height: 110px;
  border-radius: var(--radius-s);
  border: 1px solid var(--border-1);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
}
.preview-inner {
  max-width: 100%;
  max-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.preview-inner :deep(svg) {
  max-width: 240px;
  max-height: 90px;
}
</style>

<script setup lang="ts">
import { computed } from 'vue'
import type { VisualDoc } from '~/shared/schema/types'
import { useProjectStore } from '~/stores/project'
import { MAX_CUSTOM_CODE_ANIMATION_DURATION } from '~/shared/schema/constants'

const props = defineProps<{ item: VisualDoc }>()
const project = useProjectStore()

const cc = computed(() => props.item.customCode ?? {})
const enabled = computed(() => !!props.item.customCode)

function patchCC(patch: Record<string, any>) {
  const next = { ...(props.item.customCode ?? {}) }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === '') delete (next as any)[k]
    else (next as any)[k] = v
  }
  project.patchVisual(props.item._id, {
    customCode: Object.keys(next).length ? next : undefined,
  })
}

const jsWarning = computed(() => {
  const js = cc.value.js
  if (!js) return null
  if (
    /\b(fetch|XMLHttpRequest|localStorage|sessionStorage|indexedDB|window\.open|import\s*\()/i.test(
      js
    )
  ) {
    return 'Network/storage/navigation APIs are rejected by the renderer at render time.'
  }
  return null
})
</script>

<template>
  <UiSection title="Animation code (customCode)" collapsible :start-open="enabled">
    <p class="hint">
      CSS <code>@keyframes</code> and/or JS (Web Animations API) captured at
      render time as a looping frame sequence. Target the classes in your own
      markup.
    </p>
    <UiField label="CSS">
      <textarea
        class="ctl mono code"
        rows="6"
        :value="cc.css ?? ''"
        spellcheck="false"
        placeholder=".badge { animation: pulse 1s infinite; } @keyframes pulse { 50% { transform: scale(1.15); } }"
        @change="patchCC({ css: ($event.target as HTMLTextAreaElement).value })"
      />
    </UiField>
    <UiField label="JavaScript">
      <textarea
        class="ctl mono code"
        rows="5"
        :value="cc.js ?? ''"
        spellcheck="false"
        placeholder="document.querySelector('.price').animate([...], { duration: 800, iterations: Infinity })"
        @change="patchCC({ js: ($event.target as HTMLTextAreaElement).value })"
      />
    </UiField>
    <p v-if="jsWarning" class="hint warn">⚠ {{ jsWarning }}</p>
    <UiField
      label="Loop duration"
      :hint="`Length of ONE animation loop (max ${MAX_CUSTOM_CODE_ANIMATION_DURATION}s). Auto-detected when empty.`"
    >
      <UiNumberInput
        :model-value="cc.animationDuration"
        :min="0.1"
        :max="MAX_CUSTOM_CODE_ANIMATION_DURATION"
        :step="0.1"
        clearable
        placeholder="auto"
        unit="s"
        @update:model-value="patchCC({ animationDuration: $event })"
      />
    </UiField>
    <p class="hint">
      The stage preview runs this code in a sandboxed frame — the same document
      the renderer captures with its headless browser.
    </p>
  </UiSection>
</template>

<style scoped>
.code {
  font-size: 10.5px;
  line-height: 1.5;
}
.warn {
  color: var(--yellow);
}
code {
  font-family: var(--font-mono);
  font-size: 10px;
  background: var(--bg-3);
  padding: 1px 4px;
  border-radius: 3px;
}
</style>

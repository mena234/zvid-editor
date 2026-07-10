<script setup lang="ts">
import { computed } from 'vue'
import { useProjectStore } from '~/stores/project'
import { useEditorStore } from '~/stores/editor'
import { useEditorContext } from '~/composables/useEditorContext'
import { useTemplateVars } from '~/composables/useTemplateVars'
import { collectPlaceholders } from '~/shared/template/engine'
import type { VisualDoc } from '~/shared/schema/types'

const props = defineProps<{ item: VisualDoc }>()

const project = useProjectStore()
const editor = useEditorStore()
const { activeScene } = useEditorContext()
const tvars = useTemplateVars()

const conditionState = computed(() => {
  if ((props.item as any).condition === undefined) return null
  return tvars.conditionStateFor(props.item as any)
})

/** placeholder usage inside this element (any string field) */
const placeholderCount = computed(() => {
  let n = 0
  for (const count of collectPlaceholders(props.item).roots.values()) n += count
  return n
})

function patchCondition(value: string) {
  project.patchVisual(props.item._id, { condition: value || undefined })
}

/** Strict: reject conditions referencing unknown variables. */
function commitCondition(e: Event) {
  const el = e.target as HTMLInputElement
  const v = el.value
  if (v.includes('{{')) {
    const check = tvars.validateTemplateValue(v, 'any', activeScene.value)
    if (!check.ok) {
      editor.notify(check.message, 'error')
      el.value = ((props.item as any).condition as string) ?? ''
      return
    }
  }
  patchCondition(v)
}
</script>

<template>
  <UiSection title="Template">
    <UiField
      label="Condition"
      hint="This element is dropped at render when the value is false, 0, or empty"
    >
      <div class="cond-row">
        <input
          class="ctl mono"
          :value="(item as any).condition ?? ''"
          :placeholder="'{{showLogo}}'"
          spellcheck="false"
          @change="commitCondition"
        />
        <span
          v-if="conditionState"
          class="state-chip"
          :class="!conditionState.resolved ? 'warn' : conditionState.shown ? 'on' : 'off'"
          :title="
            !conditionState.resolved
              ? 'References an undefined variable — previewed as shown'
              : conditionState.shown
                ? 'Truthy with current defaults — element renders'
                : 'Falsy with current defaults — element is dropped'
          "
        >
          {{ !conditionState.resolved ? '?' : conditionState.shown ? 'on' : 'off' }}
        </span>
        <UiVarMenu
          :options="tvars.placeholderOptions(activeScene)"
          title="Use a variable as the condition"
          @insert="patchCondition($event)"
        />
      </div>
    </UiField>

    <p v-if="placeholderCount" class="hint ph-note">
      <UiIcon name="json" :size="12" />
      {{ placeholderCount }} placeholder{{ placeholderCount > 1 ? 's' : '' }} in this
      element —
      <button class="linkish" @click="editor.openPanel('variables')">
        manage variables
      </button>. Editing a field replaces its placeholder.
    </p>
  </UiSection>
</template>

<style scoped>
.cond-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.cond-row .ctl {
  flex: 1;
  min-width: 0;
}
.mono {
  font-family: var(--font-mono);
  font-size: 11px;
}
.state-chip {
  font-size: 9.5px;
  font-weight: 800;
  text-transform: uppercase;
  padding: 2px 7px;
  border-radius: 999px;
  flex: 0 0 auto;
}
.state-chip.on {
  background: color-mix(in srgb, var(--green) 12%, transparent);
  color: var(--green);
}
.state-chip.off {
  background: color-mix(in srgb, var(--red) 12%, transparent);
  color: var(--red);
}
.state-chip.warn {
  background: color-mix(in srgb, var(--yellow) 14%, transparent);
  color: var(--yellow);
}
.ph-note {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  margin-top: 8px;
}
.linkish {
  border: none;
  background: none;
  padding: 0;
  color: var(--accent-strong);
  font-size: inherit;
  cursor: pointer;
  text-decoration: underline;
}
</style>

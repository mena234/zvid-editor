<script setup lang="ts">
import { computed } from 'vue'
import type { VisualDoc } from '~/shared/schema/types'
import { canonicalVisualType } from '~/shared/schema/types'
import { useProjectStore } from '~/stores/project'
import { useEditorContext } from '~/composables/useEditorContext'
import { resolveVisualTiming } from '~/shared/schema/defaults'
import { useMediaProbe } from '~/composables/useMediaProbe'

const props = defineProps<{ item: VisualDoc }>()
const project = useProjectStore()
const { contextDuration } = useEditorContext()
const { probe } = useMediaProbe()

const type = computed(() => canonicalVisualType(props.item.type))
const timing = computed(() => resolveVisualTiming(props.item, contextDuration.value))

const sourceDuration = computed(() => {
  if (type.value !== 'VIDEO' || !props.item.src) return undefined
  const p = probe('video', props.item.src)
  return p.status === 'ok' ? p.duration : undefined
})

function patch(p: Record<string, any>) {
  project.patchVisual(props.item._id, p)
}
</script>

<template>
  <div>
    <UiSection title="Timeline window">
      <div class="grid-2">
        <UiField label="Appears at (enterBegin)">
          <UiNumberInput
            :model-value="item.enterBegin"
            :min="0"
            :step="0.1"
            placeholder="0"
            clearable
            unit="s"
            @update:model-value="patch({ enterBegin: $event })"
          />
        </UiField>
        <UiField label="Disappears at (exitEnd)" hint="Empty = end of timeline">
          <UiNumberInput
            :model-value="item.exitEnd"
            :min="0"
            :step="0.1"
            :placeholder="String(timing.exitEnd)"
            clearable
            unit="s"
            @update:model-value="patch({ exitEnd: $event })"
          />
        </UiField>
      </div>
      <div class="grid-2">
        <UiField
          label="Enter anim ends (enterEnd)"
          hint="Enter animation runs enterBegin → enterEnd"
        >
          <UiNumberInput
            :model-value="item.enterEnd"
            :min="0"
            :step="0.1"
            :placeholder="String(timing.enterBegin)"
            clearable
            unit="s"
            @update:model-value="patch({ enterEnd: $event })"
          />
        </UiField>
        <UiField
          label="Exit anim starts (exitBegin)"
          hint="Exit animation runs exitBegin → exitEnd"
        >
          <UiNumberInput
            :model-value="item.exitBegin"
            :min="0"
            :step="0.1"
            :placeholder="String(timing.exitEnd)"
            clearable
            unit="s"
            @update:model-value="patch({ exitBegin: $event })"
          />
        </UiField>
      </div>
      <p class="hint">
        Visible {{ timing.enterBegin }}s → {{ timing.exitEnd }}s. Order must be
        enterBegin ≤ enterEnd ≤ exitBegin ≤ exitEnd.
      </p>
    </UiSection>

    <UiSection v-if="type === 'VIDEO'" title="Source trim">
      <div class="grid-2">
        <UiField label="Video begin" hint="Skip into the source file">
          <UiNumberInput
            :model-value="item.videoBegin"
            :min="0"
            :step="0.1"
            placeholder="0"
            clearable
            unit="s"
            @update:model-value="patch({ videoBegin: $event })"
          />
        </UiField>
        <UiField label="Video end" hint="Stop reading the source here">
          <UiNumberInput
            :model-value="item.videoEnd"
            :min="0"
            :step="0.1"
            :placeholder="sourceDuration ? String(Math.round(sourceDuration * 100) / 100) : 'auto'"
            clearable
            unit="s"
            @update:model-value="patch({ videoEnd: $event })"
          />
        </UiField>
      </div>
      <div class="grid-2">
        <UiField label="Playback speed">
          <UiNumberInput
            :model-value="item.speed"
            :min="0.1"
            :max="10"
            :step="0.1"
            placeholder="1"
            clearable
            unit="×"
            @update:model-value="patch({ speed: $event })"
          />
        </UiField>
        <UiField label="Volume" hint="0 mutes the clip's own audio">
          <UiNumberInput
            :model-value="item.volume"
            :min="0"
            :max="2"
            :step="0.05"
            placeholder="1"
            clearable
            @update:model-value="patch({ volume: $event })"
          />
        </UiField>
      </div>
      <p v-if="sourceDuration" class="hint">
        Source duration: {{ Math.round(sourceDuration * 100) / 100 }}s
      </p>
    </UiSection>

    <UiSection v-if="type === 'GIF'" title="Playback">
      <UiField label="Speed">
        <UiNumberInput
          :model-value="item.speed"
          :min="0.1"
          :max="10"
          :step="0.1"
          placeholder="1"
          clearable
          unit="×"
          @update:model-value="patch({ speed: $event })"
        />
      </UiField>
    </UiSection>
  </div>
</template>

<style scoped>
.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
</style>

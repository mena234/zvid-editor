<script setup lang="ts">
import { computed } from 'vue'
import type { AudioDoc } from '~/shared/schema/types'
import { useProjectStore } from '~/stores/project'
import { useEditorContext } from '~/composables/useEditorContext'
import { useMediaProbe } from '~/composables/useMediaProbe'
import { resolveAudioTiming } from '~/shared/schema/defaults'

const props = defineProps<{ audio: AudioDoc }>()
const project = useProjectStore()
const { contextDuration } = useEditorContext()
const { probe } = useMediaProbe()

const probed = computed(() => (props.audio.src ? probe('audio', props.audio.src) : null))

const timing = computed(() =>
  resolveAudioTiming(props.audio, contextDuration.value, probed.value?.duration)
)

const loopInfo = computed(() => {
  const t = timing.value
  const trimmed = Math.max(0.01, t.audioEnd - t.audioBegin) / t.speed
  const window_ = t.exit - t.enter
  if (trimmed >= window_ - 0.01) return null
  return { loops: Math.ceil(window_ / trimmed), segment: Math.round(trimmed * 100) / 100 }
})

function patch(p: Record<string, any>) {
  project.patchAudio(props.audio._id, p)
}
</script>

<template>
  <div>
    <UiSection title="Source">
      <UiField label="URL / path">
        <input
          class="ctl mono src"
          :value="audio.src ?? ''"
          spellcheck="false"
          @change="patch({ src: ($event.target as HTMLInputElement).value })"
        />
      </UiField>
      <p class="hint">
        <template v-if="probed?.status === 'ok'">
          <span class="ok">✓ loaded</span>
          <template v-if="probed.duration">
            · {{ Math.round(probed.duration * 100) / 100 }}s</template
          >
        </template>
        <template v-else-if="probed?.status === 'error'">
          <span class="err">✗ failed to load</span>
        </template>
      </p>
    </UiSection>

    <UiSection title="Timeline placement">
      <div class="grid-2">
        <UiField label="Starts at (enter)">
          <UiNumberInput
            :model-value="audio.enter"
            :min="0"
            :step="0.1"
            placeholder="0"
            clearable
            unit="s"
            @update:model-value="patch({ enter: $event })"
          />
        </UiField>
        <UiField label="Ends at (exit)" hint="Empty = source length / timeline end">
          <UiNumberInput
            :model-value="audio.exit"
            :min="0"
            :step="0.1"
            :placeholder="String(Math.round(timing.exit * 100) / 100)"
            clearable
            unit="s"
            @update:model-value="patch({ exit: $event })"
          />
        </UiField>
      </div>
    </UiSection>

    <UiSection title="Source trim">
      <div class="grid-2">
        <UiField label="Audio begin">
          <UiNumberInput
            :model-value="audio.audioBegin"
            :min="0"
            :step="0.1"
            placeholder="0"
            clearable
            unit="s"
            @update:model-value="patch({ audioBegin: $event })"
          />
        </UiField>
        <UiField label="Audio end">
          <UiNumberInput
            :model-value="audio.audioEnd"
            :min="0"
            :step="0.1"
            :placeholder="probed?.duration ? String(Math.round(probed.duration * 100) / 100) : 'auto'"
            clearable
            unit="s"
            @update:model-value="patch({ audioEnd: $event })"
          />
        </UiField>
      </div>
      <p v-if="loopInfo" class="hint">
        <UiIcon name="loop" :size="11" /> The {{ loopInfo.segment }}s segment
        auto-loops ×{{ loopInfo.loops }} to fill the window.
      </p>
    </UiSection>

    <UiSection title="Mix">
      <UiField label="Volume">
        <UiSlider
          :model-value="audio.volume"
          :min="0"
          :max="2"
          :step="0.05"
          placeholder="1"
          clearable
          @update:model-value="patch({ volume: $event })"
        />
      </UiField>
      <UiField label="Speed (atempo)">
        <UiSlider
          :model-value="audio.speed"
          :min="0.5"
          :max="2"
          :step="0.05"
          placeholder="1"
          clearable
          unit="×"
          @update:model-value="patch({ speed: $event })"
        />
      </UiField>
      <UiField label="Track">
        <UiNumberInput
          :model-value="audio.track"
          :min="0"
          :step="1"
          placeholder="0"
          clearable
          @update:model-value="patch({ track: $event })"
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
.src {
  font-size: 11px;
}
.ok {
  color: var(--green);
}
.err {
  color: var(--red);
}
</style>

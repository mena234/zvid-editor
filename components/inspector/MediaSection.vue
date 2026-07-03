<script setup lang="ts">
import { computed } from 'vue'
import type { VisualDoc } from '~/shared/schema/types'
import { canonicalVisualType } from '~/shared/schema/types'
import { useProjectStore } from '~/stores/project'
import { useMediaProbe } from '~/composables/useMediaProbe'

const props = defineProps<{ item: VisualDoc }>()
const project = useProjectStore()
const { probe, intrinsicOf } = useMediaProbe()

const type = computed(() => canonicalVisualType(props.item.type))

const probed = computed(() => {
  if (!props.item.src) return null
  return probe(type.value === 'VIDEO' ? 'video' : 'image', props.item.src)
})

const intrinsic = computed(() =>
  props.item.src
    ? intrinsicOf(type.value === 'VIDEO' ? 'video' : 'image', props.item.src)
    : null
)

function patch(p: Record<string, any>) {
  project.patchVisual(props.item._id, p)
}

const zoomEnabled = computed(() => !!props.item.zoom)
const zoomDepth = computed(() => {
  const z = props.item.zoom
  return typeof z === 'object' && z !== null ? (z.depth ?? 1.2) : 1.2
})

const cropEnabled = computed(() => !!props.item.cropParams)
function toggleCrop(on: boolean) {
  if (on) {
    const nat = intrinsic.value ?? { width: 1000, height: 1000 }
    patch({
      cropParams: {
        x: Math.round(nat.width * 0.1),
        y: Math.round(nat.height * 0.1),
        width: Math.round(nat.width * 0.8),
        height: Math.round(nat.height * 0.8),
      },
    })
  } else patch({ cropParams: undefined })
}

const radiusEnabled = computed(() => !!props.item.radius)
const chromaEnabled = computed(() => !!props.item.chromaKey)
</script>

<template>
  <div>
    <UiSection title="Source">
      <UiField label="URL / path">
        <input
          class="ctl mono src-input"
          :value="item.src ?? ''"
          spellcheck="false"
          placeholder="https://…"
          @change="patch({ src: ($event.target as HTMLInputElement).value })"
        />
      </UiField>
      <p class="hint">
        <template v-if="probed?.status === 'ok'">
          <span class="ok">✓ loaded</span>
          <template v-if="intrinsic"> · {{ intrinsic.width }}×{{ intrinsic.height }}</template>
          <template v-if="probed.duration">
            · {{ Math.round(probed.duration * 100) / 100 }}s</template
          >
        </template>
        <template v-else-if="probed?.status === 'error'">
          <span class="err">✗ failed to load (URL unreachable or CORS-blocked)</span>
        </template>
        <template v-else-if="probed">loading…</template>
      </p>

      <UiField label="Resize mode" hint="Fits the media to the project frame; overrides width/height">
        <select
          class="ctl"
          :value="item.resize ?? ''"
          @change="
            patch({
              resize: ($event.target as HTMLSelectElement).value || undefined,
              ...(($event.target as HTMLSelectElement).value
                ? { width: undefined, height: undefined }
                : {}),
            })
          "
        >
          <option value="">none (use width/height)</option>
          <option value="contain">contain — letterbox, fully visible</option>
          <option value="cover">cover — fill frame, may crop</option>
        </select>
      </UiField>
    </UiSection>

    <UiSection title="Ken Burns zoom" collapsible :start-open="zoomEnabled">
      <UiField label="Enable" hint="Slow zoom-in across the visible window (zoompan)">
        <input
          type="checkbox"
          :checked="zoomEnabled"
          @change="
            patch({
              zoom: ($event.target as HTMLInputElement).checked
                ? { depth: zoomDepth }
                : undefined,
            })
          "
        />
      </UiField>
      <UiField v-if="zoomEnabled" label="Depth" :hint="`Ends at ${zoomDepth}× zoom`">
        <input
          type="range"
          min="1.05"
          max="3"
          step="0.05"
          :value="zoomDepth"
          @input="patch({ zoom: { depth: Number(($event.target as HTMLInputElement).value) } })"
        />
        <span class="mono val">{{ zoomDepth }}×</span>
      </UiField>
    </UiSection>

    <UiSection title="Crop" collapsible :start-open="cropEnabled">
      <UiField label="Enable" hint="Crop a source rectangle before scaling to the element size">
        <input
          type="checkbox"
          :checked="cropEnabled"
          @change="toggleCrop(($event.target as HTMLInputElement).checked)"
        />
      </UiField>
      <template v-if="item.cropParams">
        <div class="grid-2">
          <UiField label="X">
            <UiNumberInput
              :model-value="item.cropParams.x"
              :min="0"
              unit="px"
              @update:model-value="patch({ cropParams: { ...item.cropParams, x: $event ?? 0 } })"
            />
          </UiField>
          <UiField label="Y">
            <UiNumberInput
              :model-value="item.cropParams.y"
              :min="0"
              unit="px"
              @update:model-value="patch({ cropParams: { ...item.cropParams, y: $event ?? 0 } })"
            />
          </UiField>
        </div>
        <div class="grid-2">
          <UiField label="Width">
            <UiNumberInput
              :model-value="item.cropParams.width"
              :min="1"
              unit="px"
              @update:model-value="patch({ cropParams: { ...item.cropParams, width: $event ?? 1 } })"
            />
          </UiField>
          <UiField label="Height">
            <UiNumberInput
              :model-value="item.cropParams.height"
              :min="1"
              unit="px"
              @update:model-value="patch({ cropParams: { ...item.cropParams, height: $event ?? 1 } })"
            />
          </UiField>
        </div>
        <p v-if="intrinsic" class="hint">
          Source is {{ intrinsic.width }}×{{ intrinsic.height }}px
        </p>
      </template>
    </UiSection>

    <UiSection
      v-if="type === 'IMAGE'"
      title="Rounded corners"
      collapsible
      :start-open="radiusEnabled"
    >
      <UiField label="Enable">
        <input
          type="checkbox"
          :checked="radiusEnabled"
          @change="
            patch({
              radius: ($event.target as HTMLInputElement).checked
                ? { tl: 24, tr: 24, bl: 24, br: 24 }
                : undefined,
            })
          "
        />
      </UiField>
      <div v-if="item.radius" class="grid-2">
        <UiField label="Top-left">
          <UiNumberInput
            :model-value="item.radius.tl"
            :min="0"
            unit="px"
            @update:model-value="patch({ radius: { ...item.radius, tl: $event ?? 0 } })"
          />
        </UiField>
        <UiField label="Top-right">
          <UiNumberInput
            :model-value="item.radius.tr"
            :min="0"
            unit="px"
            @update:model-value="patch({ radius: { ...item.radius, tr: $event ?? 0 } })"
          />
        </UiField>
        <UiField label="Bottom-left">
          <UiNumberInput
            :model-value="item.radius.bl"
            :min="0"
            unit="px"
            @update:model-value="patch({ radius: { ...item.radius, bl: $event ?? 0 } })"
          />
        </UiField>
        <UiField label="Bottom-right">
          <UiNumberInput
            :model-value="item.radius.br"
            :min="0"
            unit="px"
            @update:model-value="patch({ radius: { ...item.radius, br: $event ?? 0 } })"
          />
        </UiField>
      </div>
    </UiSection>

    <UiSection
      v-if="type === 'VIDEO' || type === 'IMAGE'"
      title="Chroma key"
      collapsible
      :start-open="chromaEnabled"
    >
      <UiField label="Enable" hint="Removes a color (green screen). Preview shows a badge; the effect applies at render time.">
        <input
          type="checkbox"
          :checked="chromaEnabled"
          @change="
            patch({
              chromaKey: ($event.target as HTMLInputElement).checked
                ? { color: '#00ff00', similarity: 20, blend: 10 }
                : undefined,
            })
          "
        />
      </UiField>
      <template v-if="item.chromaKey">
        <UiField label="Key color">
          <UiColorInput
            :model-value="item.chromaKey.color"
            @update:model-value="patch({ chromaKey: { ...item.chromaKey, color: $event ?? '#00ff00' } })"
          />
        </UiField>
        <div class="grid-2">
          <UiField label="Similarity (0–100)">
            <UiNumberInput
              :model-value="item.chromaKey.similarity"
              :min="0"
              :max="100"
              placeholder="0"
              clearable
              @update:model-value="patch({ chromaKey: { ...item.chromaKey, similarity: $event } })"
            />
          </UiField>
          <UiField label="Blend (0–100)">
            <UiNumberInput
              :model-value="item.chromaKey.blend"
              :min="0"
              :max="100"
              placeholder="0"
              clearable
              @update:model-value="patch({ chromaKey: { ...item.chromaKey, blend: $event } })"
            />
          </UiField>
        </div>
      </template>
    </UiSection>
  </div>
</template>

<style scoped>
.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.src-input {
  font-size: 11px;
}
.ok {
  color: var(--green);
}
.err {
  color: var(--red);
}
.val {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--text-1);
  margin-left: 6px;
}
</style>

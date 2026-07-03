<script setup lang="ts">
import { computed } from 'vue'
import type { VisualDoc } from '~/shared/schema/types'
import { useProjectStore } from '~/stores/project'
import { POSITION_PRESETS } from '~/shared/schema/constants'
import { effectiveLayout } from '~/utils/itemGeometry'

const props = defineProps<{ item: VisualDoc }>()
const project = useProjectStore()

const layout = computed(() =>
  effectiveLayout(props.item, project.defaults.width, project.defaults.height)
)

function patch(p: Record<string, any>) {
  project.patchVisual(props.item._id, p)
}
</script>

<template>
  <UiSection title="Layout" collapsible>
    <UiField label="Position preset" hint="Overwrites x/y with the preset coordinates">
      <select
        class="ctl"
        :value="item.position ?? 'custom'"
        @change="
          patch({
            position:
              ($event.target as HTMLSelectElement).value === 'custom'
                ? undefined
                : ($event.target as HTMLSelectElement).value,
            ...((($event.target as HTMLSelectElement).value !== 'custom')
              ? { x: undefined, y: undefined }
              : { x: layout.x, y: layout.y }),
          })
        "
      >
        <option v-for="p in POSITION_PRESETS" :key="p" :value="p">{{ p }}</option>
      </select>
    </UiField>

    <div class="grid-2">
      <UiField label="X (anchor point)">
        <UiNumberInput
          :model-value="item.x ?? layout.x"
          :step="1"
          unit="px"
          @update:model-value="patch({ x: $event ?? 0, position: item.position && item.position !== 'custom' ? 'custom' : undefined, anchor: layout.anchor })"
        />
      </UiField>
      <UiField label="Y (anchor point)">
        <UiNumberInput
          :model-value="item.y ?? layout.y"
          :step="1"
          unit="px"
          @update:model-value="patch({ y: $event ?? 0, position: item.position && item.position !== 'custom' ? 'custom' : undefined, anchor: layout.anchor })"
        />
      </UiField>
    </div>

    <div class="anchor-row">
      <UiField label="Anchor" hint="Which point of the element sits at (x, y)">
        <UiAnchorPicker
          :model-value="item.anchor ?? layout.anchor"
          @update:model-value="patch({ anchor: $event })"
        />
      </UiField>
      <div class="grid-2 grow">
        <UiField label="Width" hint="Empty = intrinsic / measured size">
          <UiNumberInput
            :model-value="item.width"
            :min="1"
            :placeholder="String(Math.round(layout.width))"
            clearable
            unit="px"
            @update:model-value="patch({ width: $event, resize: $event !== undefined ? undefined : item.resize })"
          />
        </UiField>
        <UiField label="Height">
          <UiNumberInput
            :model-value="item.height"
            :min="1"
            :placeholder="String(Math.round(layout.height))"
            clearable
            unit="px"
            @update:model-value="patch({ height: $event, resize: $event !== undefined ? undefined : item.resize })"
          />
        </UiField>
      </div>
    </div>

    <div class="grid-3">
      <UiField label="Rotation">
        <UiNumberInput
          :model-value="item.angle"
          :min="-360"
          :max="360"
          placeholder="0"
          clearable
          unit="°"
          @update:model-value="patch({ angle: $event })"
        />
      </UiField>
      <UiField label="Opacity">
        <UiNumberInput
          :model-value="item.opacity"
          :min="0"
          :max="1"
          :step="0.05"
          placeholder="1"
          clearable
          @update:model-value="patch({ opacity: $event })"
        />
      </UiField>
      <UiField label="Track (z)" hint="Higher tracks render on top">
        <UiNumberInput
          :model-value="item.track"
          :min="0"
          :step="1"
          placeholder="0"
          clearable
          @update:model-value="patch({ track: $event })"
        />
      </UiField>
    </div>

    <div class="flip-row">
      <button
        class="btn sm"
        :class="{ primary: item.flipH }"
        title="Flip horizontally"
        @click="patch({ flipH: item.flipH ? undefined : true })"
      >
        <UiIcon name="flip_h" :size="13" /> Flip H
      </button>
      <button
        class="btn sm"
        :class="{ primary: item.flipV }"
        title="Flip vertically"
        @click="patch({ flipV: item.flipV ? undefined : true })"
      >
        <UiIcon name="flip_v" :size="13" /> Flip V
      </button>
    </div>
  </UiSection>
</template>

<style scoped>
.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.grid-3 {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 8px;
}
.anchor-row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}
.grow {
  flex: 1;
}
.flip-row {
  display: flex;
  gap: 6px;
}
</style>

<script setup lang="ts">
import { computed } from 'vue'
import type { VisualDoc } from '~/shared/schema/types'
import { canonicalVisualType } from '~/shared/schema/types'
import { makeId } from '~/shared/schema/normalize'
import { useProjectStore } from '~/stores/project'
import { useEditorContext } from '~/composables/useEditorContext'
import { XFADE_GROUPS } from '~/shared/schema/constants'
import { resolveVisualTiming } from '~/shared/schema/defaults'
import { round3 } from '~/utils/time'

const props = defineProps<{ item: VisualDoc }>()
const project = useProjectStore()
const { contextDuration, contextVisuals } = useEditorContext()

const type = computed(() => canonicalVisualType(props.item.type))
const timing = computed(() => resolveVisualTiming(props.item, contextDuration.value))

function patch(p: Record<string, any>) {
  project.patchVisual(props.item._id, p)
}

function setEnter(effect: string) {
  if (!effect) {
    patch({ enterAnimation: undefined })
    return
  }
  const p: Record<string, any> = { enterAnimation: effect }
  // give the animation a window if there is none
  if (timing.value.enterEnd <= timing.value.enterBegin) {
    p.enterEnd = round3(
      Math.min(timing.value.enterBegin + 1, timing.value.exitBegin)
    )
  }
  patch(p)
}

function setExit(effect: string) {
  if (!effect) {
    patch({ exitAnimation: undefined })
    return
  }
  const p: Record<string, any> = { exitAnimation: effect }
  if (timing.value.exitBegin >= timing.value.exitEnd) {
    p.exitBegin = round3(Math.max(timing.value.exitEnd - 1, timing.value.enterEnd))
    p.exitEnd = timing.value.exitEnd
  }
  patch(p)
}

/* ---------------- video → video transition ---------------- */
const otherVideos = computed(() =>
  contextVisuals.value.filter(
    (v) => v._id !== props.item._id && canonicalVisualType(v.type) === 'VIDEO'
  )
)

const linkedTarget = computed(() =>
  otherVideos.value.find((v) => v.id && v.id === props.item.transitionId)
)

function linkTransition(targetEditorId: string) {
  if (!targetEditorId) {
    patch({ transition: undefined, transitionId: undefined, transitionDuration: undefined })
    return
  }
  const target = project.visualById(targetEditorId)
  if (!target) return
  let targetId = target.id as string | undefined
  if (!targetId) {
    targetId = `vid-${makeId('t').slice(-6)}`
    project.patchVisual(target._id, { id: targetId }, false)
  }
  if (!props.item.id) {
    project.patchVisual(props.item._id, { id: `vid-${makeId('s').slice(-6)}` }, false)
  }
  patch({
    transition: props.item.transition ?? 'fade',
    transitionId: targetId,
    transitionDuration: props.item.transitionDuration ?? 0.5,
  })
}
</script>

<template>
  <div>
    <UiSection title="Enter animation">
      <select
        class="ctl"
        :value="item.enterAnimation ?? ''"
        @change="setEnter(($event.target as HTMLSelectElement).value)"
      >
        <option value="">none</option>
        <optgroup v-for="(effects, group) in XFADE_GROUPS" :key="group" :label="String(group)">
          <option v-for="fx in effects" :key="fx" :value="fx">{{ fx }}</option>
        </optgroup>
      </select>
      <template v-if="item.enterAnimation">
        <InspectorXfadePreview :effect="item.enterAnimation" direction="enter" />
        <UiField
          label="Duration"
          :hint="`Runs ${timing.enterBegin}s → ${timing.enterEnd}s (drag the yellow handle on the clip)`"
        >
          <UiNumberInput
            :model-value="round3(timing.enterEnd - timing.enterBegin)"
            :min="0.05"
            :max="10"
            :step="0.1"
            unit="s"
            @update:model-value="
              patch({ enterEnd: round3(timing.enterBegin + ($event ?? 0.5)) })
            "
          />
        </UiField>
      </template>
    </UiSection>

    <UiSection title="Exit animation">
      <select
        class="ctl"
        :value="item.exitAnimation ?? ''"
        @change="setExit(($event.target as HTMLSelectElement).value)"
      >
        <option value="">none</option>
        <optgroup v-for="(effects, group) in XFADE_GROUPS" :key="group" :label="String(group)">
          <option v-for="fx in effects" :key="fx" :value="fx">{{ fx }}</option>
        </optgroup>
      </select>
      <template v-if="item.exitAnimation">
        <InspectorXfadePreview :effect="item.exitAnimation" direction="exit" />
        <UiField label="Duration" :hint="`Runs ${timing.exitBegin}s → ${timing.exitEnd}s`">
          <UiNumberInput
            :model-value="round3(timing.exitEnd - timing.exitBegin)"
            :min="0.05"
            :max="10"
            :step="0.1"
            unit="s"
            @update:model-value="
              patch({ exitBegin: round3(timing.exitEnd - ($event ?? 0.5)) })
            "
          />
        </UiField>
        <p v-if="item.transition && item.transitionId" class="hint warn">
          ⚠ This clip has a transition — the renderer suppresses the exit
          animation when a transition is set.
        </p>
      </template>
    </UiSection>

    <UiSection v-if="type === 'VIDEO'" title="Transition to another video" collapsible :start-open="!!item.transition">
      <p class="hint">
        Cross-fades this video into another video item (xfade), like a cut in a
        montage.
      </p>
      <UiField label="Target video">
        <select
          class="ctl"
          :value="linkedTarget?._id ?? ''"
          @change="linkTransition(($event.target as HTMLSelectElement).value)"
        >
          <option value="">none</option>
          <option v-for="v in otherVideos" :key="v._id" :value="v._id">
            {{ v.id ?? v.src?.split('/').pop() ?? v._id }}
          </option>
        </select>
      </UiField>
      <template v-if="item.transition && item.transitionId">
        <UiField label="Effect">
          <select
            class="ctl"
            :value="item.transition"
            @change="patch({ transition: ($event.target as HTMLSelectElement).value })"
          >
            <optgroup v-for="(effects, group) in XFADE_GROUPS" :key="group" :label="String(group)">
              <option v-for="fx in effects" :key="fx" :value="fx">{{ fx }}</option>
            </optgroup>
          </select>
        </UiField>
        <UiField label="Overlap duration">
          <UiNumberInput
            :model-value="item.transitionDuration ?? 0.5"
            :min="0.05"
            :max="5"
            :step="0.1"
            unit="s"
            @update:model-value="patch({ transitionDuration: $event })"
          />
        </UiField>
      </template>
    </UiSection>
  </div>
</template>

<style scoped>
.warn {
  color: var(--yellow);
}
</style>

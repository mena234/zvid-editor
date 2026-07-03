<script setup lang="ts">
import { computed } from 'vue'
import { useEditorContext } from '~/composables/useEditorContext'
import { XFADE_EFFECTS } from '~/shared/schema/constants'

const { project, editor, scenePlan } = useEditorContext()

/** the scene being configured: explicit selection or the editing context */
const scene = computed(() => {
  if (editor.selectionKind === 'scene' && editor.selectedId)
    return project.sceneByEditorId(editor.selectedId)
  if (editor.context !== 'root') return project.sceneByEditorId(editor.context)
  return undefined
})

const entry = computed(() =>
  scenePlan.value?.entries.find((e) => e.scene._id === scene.value?._id)
)

const isLast = computed(() => {
  const scenes = project.doc.scenes ?? []
  return scenes.length > 0 && scenes[scenes.length - 1]._id === scene.value?._id
})

const isAuto = computed(() => (scene.value?.duration ?? -1) === -1)

function patch(patchObj: Record<string, any>) {
  if (scene.value) project.patchScene(scene.value._id, patchObj)
}
</script>

<template>
  <div v-if="scene" class="scene-settings">
    <UiField label="Scene id" hint="Referenced by the previous scene's transitionId">
      <input
        class="ctl"
        :value="scene.id"
        spellcheck="false"
        @change="patch({ id: ($event.target as HTMLInputElement).value || scene.id })"
      />
    </UiField>

    <UiField label="Duration" hint="-1 / auto derives the duration from the scene's content">
      <div class="dur-row">
        <label class="check">
          <input
            type="checkbox"
            :checked="isAuto"
            @change="
              patch({
                duration: ($event.target as HTMLInputElement).checked
                  ? -1
                  : (entry?.duration ?? 5),
              })
            "
          />
          auto
        </label>
        <UiNumberInput
          v-if="!isAuto"
          :model-value="scene.duration"
          :min="0.1"
          :step="0.5"
          unit="s"
          @update:model-value="patch({ duration: $event ?? -1 })"
        />
        <span v-else class="hint">computed: {{ entry?.duration ?? '…' }}s</span>
      </div>
    </UiField>

    <UiField label="Background color" hint="Falls back to the project background">
      <UiColorInput
        :model-value="scene.backgroundColor"
        clearable
        placeholder="project default"
        @update:model-value="patch({ backgroundColor: $event })"
      />
    </UiField>

    <template v-if="!isLast">
      <UiField label="Transition to next scene">
        <select
          class="ctl"
          :value="scene.transition ?? ''"
          @change="
            patch({
              transition: ($event.target as HTMLSelectElement).value || undefined,
              transitionDuration:
                ($event.target as HTMLSelectElement).value
                  ? (scene.transitionDuration ?? 0.5)
                  : undefined,
            })
          "
        >
          <option value="">none (hard cut)</option>
          <option v-for="fx in XFADE_EFFECTS" :key="fx" :value="fx">{{ fx }}</option>
        </select>
      </UiField>
      <UiField
        v-if="scene.transition"
        label="Transition duration"
        hint="The scenes overlap by this long (xfade)"
      >
        <UiNumberInput
          :model-value="scene.transitionDuration ?? 0.5"
          :min="0.05"
          :max="10"
          :step="0.1"
          unit="s"
          @update:model-value="patch({ transitionDuration: $event })"
        />
      </UiField>
    </template>
    <p v-else class="hint">Last scene — transitions apply between consecutive scenes.</p>
  </div>
</template>

<style scoped>
.scene-settings {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.dur-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.check {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  color: var(--text-1);
  white-space: nowrap;
}
</style>

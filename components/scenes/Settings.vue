<script setup lang="ts">
import { computed } from 'vue'
import { useEditorContext } from '~/composables/useEditorContext'
import { useTemplateVars } from '~/composables/useTemplateVars'
import { variableTypeOf } from '~/shared/template/engine'

const { project, editor, scenePlan } = useEditorContext()
const tvars = useTemplateVars()

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

function setSceneTransition(effect?: string) {
  patch({
    transition: effect || undefined,
    transitionDuration: effect
      ? (scene.value?.transitionDuration ?? 0.5)
      : undefined,
  })
}

/* ---------------- template: condition + iterate ---------------- */
const arrayVariables = computed(() =>
  Object.entries(tvars.variables.value)
    .filter(([, v]) => variableTypeOf(v) === 'array')
    .map(([name, v]) => ({ name, count: (v as unknown[]).length }))
)

const iterateInfo = computed(() =>
  scene.value ? tvars.iterateInfoFor(scene.value) : null
)

/** current iterate path is kept selectable even if it's a custom dot-path */
const iterateOptions = computed(() => {
  const opts = arrayVariables.value.map((v) => ({
    value: v.name,
    label: `${v.name} (${v.count} item${v.count === 1 ? '' : 's'})`,
  }))
  const current = (scene.value as any)?.iterate
  if (current && !opts.some((o) => o.value === current)) {
    opts.push({ value: String(current), label: String(current) })
  }
  return opts
})

const conditionState = computed(() => {
  const c = (scene.value as any)?.condition
  if (c === undefined || !scene.value) return null
  return tvars.conditionStateFor(scene.value as any, tvars.scenePreviewScope(scene.value))
})

function patchIterate(path: string) {
  if (!path) {
    patch({ iterate: undefined, iterateAs: undefined })
  } else {
    patch({ iterate: path })
  }
}

/** Strict: reject conditions referencing unknown variables. */
function commitCondition(e: Event) {
  const el = e.target as HTMLInputElement
  const v = el.value
  if (v.includes('{{') && scene.value) {
    const check = tvars.validateTemplateValue(v, 'any', scene.value)
    if (!check.ok) {
      editor.notify(check.message, 'error')
      el.value = ((scene.value as any).condition as string) ?? ''
      return
    }
  }
  patch({ condition: v || undefined })
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

    <UiField
      label="Duration"
      :hint="'-1 / auto derives the duration from the scene\'s content; a {{placeholder}} resolves at render'"
    >
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
        <span v-if="isAuto" class="hint">computed: {{ entry?.duration ?? '…' }}s</span>
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
        <UiEffectPicker
          :model-value="scene.transition ? String(scene.transition) : undefined"
          direction="transition"
          none-label="None (hard cut)"
          @update:model-value="setSceneTransition($event)"
        />
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

    <div class="tpl-divider">
      <span>Template</span>
    </div>

    <UiField
      label="Condition"
      hint="The scene is skipped at render when this resolves to false, 0, or empty"
    >
      <div class="cond-row">
        <input
          class="ctl mono"
          :value="(scene as any).condition ?? ''"
          :placeholder="'{{showIntro}}'"
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
                ? 'Truthy with current defaults — scene renders'
                : 'Falsy with current defaults — scene is skipped'
          "
        >
          {{ !conditionState.resolved ? '?' : conditionState.shown ? 'on' : 'off' }}
        </span>
        <UiVarMenu
          :options="tvars.placeholderOptions(scene)"
          title="Use a variable as the condition"
          @insert="patch({ condition: $event })"
        />
      </div>
    </UiField>

    <UiField
      label="Repeat for each item (iterate)"
      hint="Renders one copy of this scene per item of an array variable"
    >
      <select
        class="ctl"
        :value="(scene as any).iterate ?? ''"
        @change="patchIterate(($event.target as HTMLSelectElement).value)"
      >
        <option value="">off</option>
        <option v-for="opt in iterateOptions" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>
      <p v-if="!arrayVariables.length && !(scene as any).iterate" class="hint">
        Add an <b>array</b> variable in the Variables panel to enable this.
      </p>
    </UiField>

    <template v-if="iterateInfo?.active">
      <UiField
        label="Item alias"
        :hint="`Reference fields as {{${iterateInfo.alias}.field}} and the position as {{index}}`"
      >
        <input
          class="ctl mono"
          :value="(scene as any).iterateAs ?? 'item'"
          spellcheck="false"
          @change="
            patch({
              iterateAs:
                ($event.target as HTMLInputElement).value === 'item'
                  ? undefined
                  : ($event.target as HTMLInputElement).value || undefined,
            })
          "
        />
      </UiField>
      <p v-if="iterateInfo.error" class="err">{{ iterateInfo.error }}</p>
      <p v-else class="hint iterate-note">
        Renders as <b>{{ iterateInfo.items?.length ?? 0 }} scene{{
          (iterateInfo.items?.length ?? 0) === 1 ? '' : 's'
        }}</b> — the stage previews the first item.
      </p>
    </template>
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
.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
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
.tpl-divider {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-3);
}
.tpl-divider::before,
.tpl-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border-0);
}
.cond-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.cond-row .ctl {
  flex: 1;
  min-width: 0;
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
.mono {
  font-family: var(--font-mono);
  font-size: 11px;
}
.err {
  color: var(--red);
  font-size: 11px;
  margin: 2px 0 0;
}
.iterate-note {
  margin: 2px 0 0;
}
</style>

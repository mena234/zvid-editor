<script setup lang="ts">
import { computed } from 'vue'
import { useEditorContext } from '~/composables/useEditorContext'
import { useTemplateVars } from '~/composables/useTemplateVars'
import type { SceneDoc } from '~/shared/schema/types'

const { project, editor, scenePlan } = useEditorContext()
const tvars = useTemplateVars()

function templateBadges(s: SceneDoc) {
  const badges: { text: string; kind: 'iterate' | 'cond-on' | 'cond-off' | 'warn' }[] = []
  const it = tvars.iterateInfoFor(s)
  if (it.active) {
    badges.push(
      it.error
        ? { text: '×?', kind: 'warn' }
        : { text: `×${it.items?.length ?? 0}`, kind: 'iterate' }
    )
  }
  if ((s as any).condition !== undefined) {
    const c = tvars.conditionStateFor(s as any, tvars.scenePreviewScope(s))
    badges.push(
      !c.resolved
        ? { text: 'if ?', kind: 'warn' }
        : { text: c.shown ? 'if ✓' : 'if ✗', kind: c.shown ? 'cond-on' : 'cond-off' }
    )
  }
  return badges
}

function deleteScene(editorId: string) {
  project.removeScene(editorId)
  if (editor.context === editorId) editor.setContext('root')
}

const scenes = computed(() => project.doc.scenes ?? [])

function entryFor(id: string) {
  return scenePlan.value?.entries.find((e) => e.scene._id === id)
}

function flatten() {
  if (!scenePlan.value) return
  const starts: Record<string, number> = {}
  for (const e of scenePlan.value.entries) starts[e.scene._id] = e.start
  const total = scenePlan.value.totalScenesDuration
  project.flattenScenes(starts)
  project.patchProject({ duration: Math.max(project.doc.duration ?? 0, total) })
  editor.setContext('root')
  editor.notify('Scenes flattened into the root timeline', 'success')
}
</script>

<template>
  <div>
    <UiSection title="Scenes">
      <template #actions>
        <button
          v-if="scenes.length"
          class="btn ghost sm"
          title="Merge all scenes into a single flat timeline"
          @click="flatten"
        >
          flatten
        </button>
      </template>

      <p v-if="!scenes.length" class="hint">
        Scenes are self-contained mini-timelines rendered separately and joined
        with transitions — great for slideshows and story-style videos.
      </p>

      <div class="scene-list">
        <button
          class="scene-card global"
          :class="{ active: editor.context === 'root' }"
          @click="editor.setContext('root')"
        >
          <UiIcon name="layers" :size="14" />
          <div class="scene-meta">
            <b>Global overlays</b>
            <span class="hint"
              >{{ project.doc.visuals.length }} visuals ·
              {{ project.doc.audios.length }} audios — span the whole movie</span
            >
          </div>
        </button>

        <div
          v-for="(s, i) in scenes"
          :key="s._id"
          class="scene-card"
          :class="{ active: editor.context === s._id }"
          role="button"
          tabindex="0"
          @click="editor.setContext(s._id)"
        >
          <span
            class="scene-swatch"
            :style="{ background: s.backgroundColor ?? project.doc.backgroundColor ?? '#fff' }"
          />
          <div class="scene-meta">
            <b>
              {{ s.id }}
              <span
                v-for="(b, bi) in templateBadges(s)"
                :key="bi"
                class="tpl-badge"
                :class="b.kind"
                :title="
                  b.kind === 'iterate'
                    ? 'Repeats per array item at render (stage previews the first)'
                    : b.kind === 'warn'
                      ? 'Template problem — check the scene settings'
                      : 'Conditional scene (state with current defaults)'
                "
              >
                {{ b.text }}
              </span>
            </b>
            <span class="hint">
              {{
                (s.duration ?? -1) === -1
                  ? `auto (${entryFor(s._id)?.duration ?? '…'}s)`
                  : `${s.duration}s`
              }}
              · {{ s.visuals.length }} visuals
              <template v-if="s.transition"> · {{ s.transition }} →</template>
            </span>
          </div>
          <span class="scene-actions" @click.stop>
            <button
              class="icon-btn xs"
              :disabled="i === 0"
              title="Move up"
              @click="project.moveScene(s._id, -1)"
            >
              <UiIcon name="chevron_up" :size="12" />
            </button>
            <button
              class="icon-btn xs"
              :disabled="i === scenes.length - 1"
              title="Move down"
              @click="project.moveScene(s._id, 1)"
            >
              <UiIcon name="chevron_down" :size="12" />
            </button>
            <button
              class="icon-btn xs danger"
              title="Delete scene"
              @click="deleteScene(s._id)"
            >
              <UiIcon name="trash" :size="12" />
            </button>
          </span>
        </div>
      </div>

      <div class="row">
        <button class="btn sm" @click="editor.setContext(project.addScene()._id)">
          <UiIcon name="plus" :size="12" /> Add scene
        </button>
        <button
          v-if="!scenes.length && (project.doc.visuals.length || project.doc.audios.length)"
          class="btn ghost sm"
          title="Wrap the current flat timeline into a first scene"
          @click="project.convertToScenes()"
        >
          convert timeline → scene
        </button>
      </div>
    </UiSection>

    <UiSection v-if="editor.selectionKind === 'scene' || editor.context !== 'root'" title="Scene settings">
      <ScenesSettings />
    </UiSection>
  </div>
</template>

<style scoped>
.scene-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 8px;
}
.scene-card {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 8px 9px;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-m);
  background: var(--bg-2);
  color: var(--text-0);
  text-align: left;
  cursor: pointer;
}
.scene-card:hover {
  border-color: var(--border-2);
}
.scene-card.active {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.scene-card.global {
  border-style: dashed;
}
.scene-swatch {
  width: 26px;
  height: 26px;
  border-radius: 5px;
  border: 1px solid var(--border-2);
  flex: 0 0 auto;
}
.scene-meta {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
}
.scene-meta b {
  font-size: 12px;
}
.tpl-badge {
  display: inline-block;
  margin-left: 4px;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 9px;
  font-weight: 800;
  vertical-align: 1px;
}
.tpl-badge.iterate {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent-strong);
}
.tpl-badge.cond-on {
  background: color-mix(in srgb, var(--green) 12%, transparent);
  color: var(--green);
}
.tpl-badge.cond-off {
  background: color-mix(in srgb, var(--red) 12%, transparent);
  color: var(--red);
}
.tpl-badge.warn {
  background: color-mix(in srgb, var(--yellow) 14%, transparent);
  color: var(--yellow);
}
.scene-meta .hint {
  font-size: 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.scene-actions {
  display: flex;
  gap: 2px;
}
.icon-btn.danger:hover {
  color: var(--red);
}
.row {
  display: flex;
  gap: 6px;
}
</style>

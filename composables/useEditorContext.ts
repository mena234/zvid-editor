import { computed } from 'vue'
import { useProjectStore } from '~/stores/project'
import { useEditorStore } from '~/stores/editor'
import { useMediaProbe } from '~/composables/useMediaProbe'
import { buildScenePlan, projectTotalDuration } from '~/shared/schema/scenePlan'
import type { VisualDoc, AudioDoc, SceneDoc } from '~/shared/schema/types'

/**
 * Context-aware view over the project: 'root' edits the flat/global timeline,
 * a scene _id scopes the stage + timeline to that scene's local timeline.
 */
export function useEditorContext() {
  const project = useProjectStore()
  const editor = useEditorStore()
  const { probeDuration } = useMediaProbe()

  /**
   * The document the preview/timeline is planned from: with variables
   * preview on, iterate scenes are expanded and condition-falsy content is
   * pruned (matching what orch renders); otherwise the raw document.
   * Editing state (activeScene, contextVisuals, …) always stays raw.
   */
  const displayDoc = computed(() => project.resolvedPreviewDoc)

  const scenePlan = computed(() =>
    displayDoc.value.scenes?.length ? buildScenePlan(displayDoc.value, probeDuration) : null
  )

  const activeScene = computed<SceneDoc | null>(() =>
    editor.context === 'root'
      ? null
      : (project.doc.scenes?.find((s) => s._id === editor.context) ?? null)
  )

  const activeScenePlanEntry = computed(() =>
    activeScene.value
      ? (scenePlan.value?.entries.find((e) => e.scene._id === activeScene.value!._id) ??
        null)
      : null
  )

  /** timeline duration of the current editing context */
  const contextDuration = computed<number>(() => {
    if (activeScene.value) {
      return activeScenePlanEntry.value?.duration ?? 10
    }
    if (project.doc.scenes?.length && editor.scenePreviewMode === 'full') {
      return projectTotalDuration(displayDoc.value, probeDuration)
    }
    return project.defaults.duration
  })

  /** total duration of the final movie (for export/global overlays) */
  const totalDuration = computed<number>(() =>
    projectTotalDuration(displayDoc.value, probeDuration)
  )

  const contextVisuals = computed<VisualDoc[]>(() =>
    activeScene.value ? activeScene.value.visuals : project.doc.visuals
  )

  const contextAudios = computed<AudioDoc[]>(() =>
    activeScene.value ? activeScene.value.audios : project.doc.audios
  )

  const contextBackgroundColor = computed<string>(() => {
    if (activeScene.value)
      return (
        activeScene.value.backgroundColor ??
        project.doc.backgroundColor ??
        '#ffffff'
      )
    return project.doc.backgroundColor ?? '#ffffff'
  })

  return {
    project,
    editor,
    scenePlan,
    activeScene,
    activeScenePlanEntry,
    contextDuration,
    totalDuration,
    contextVisuals,
    contextAudios,
    contextBackgroundColor,
  }
}

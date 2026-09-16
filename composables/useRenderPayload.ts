import { useProjectStore } from '~/stores/project'
import { useMediaProbe } from '~/composables/useMediaProbe'
import { resolveDocPreview } from '~/shared/template/engine'
import { buildScenePlan, projectTotalDuration } from '~/shared/schema/scenePlan'
import { exportProject } from '~/shared/schema/normalize'

/** Freeze only the submitted render; saved/exported authoring documents stay editable. */
export function useRenderPayload() {
  const project = useProjectStore()
  const { probeDuration } = useMediaProbe()
  return () => {
    if (project.isImage) return project.exportRaw()
    const doc = resolveDocPreview(project.doc, project.variables)
    const probe = (src: string) => {
      const duration = probeDuration(src)
      if (duration === undefined)
        throw new Error(
          'Media length is not available yet. Wait for the media to load, or set its end time before rendering.'
        )
      return duration
    }
    const duration = projectTotalDuration(doc, probe)
    const plan = buildScenePlan(doc, probe)
    const payload = exportProject(doc)
    delete payload.durationMode
    payload.duration = duration
    const resolveAudio = (items: any[], end: number) => {
      for (const audio of items ?? []) {
        if (audio.matchDuration) audio.exit = end
        delete audio.matchDuration
      }
    }
    resolveAudio(payload.audios, duration)
    payload.scenes?.forEach((scene: any, index: number) => {
      scene.duration = plan.entries[index].duration
      resolveAudio(scene.audios, scene.duration)
    })
    return payload
  }
}

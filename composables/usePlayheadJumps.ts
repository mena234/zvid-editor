import { computed } from 'vue'
import { useEditorContext } from '~/composables/useEditorContext'
import { useMediaProbe } from '~/composables/useMediaProbe'
import { resolveVisualTiming, resolveAudioTiming } from '~/shared/schema/defaults'
import { round3 } from '~/utils/time'

/**
 * Playhead navigation over the interesting points of the current context:
 * the start of every visual/audio element plus every scene boundary, with
 * 0 and the context end as the outer stops. The transport skip buttons and
 * Home/End walk these points instead of teleporting straight to 0/end.
 */
export function usePlayheadJumps() {
  const {
    project,
    editor,
    scenePlan,
    activeScene,
    contextDuration,
    contextVisuals,
    contextAudios,
  } = useEditorContext()
  const { probe } = useMediaProbe()

  const jumpPoints = computed<number[]>(() => {
    const pts = new Set<number>([0, round3(contextDuration.value)])
    for (const v of contextVisuals.value) {
      pts.add(round3(resolveVisualTiming(v, contextDuration.value).enterBegin))
    }
    for (const a of contextAudios.value) {
      const src = a.src ? probe('audio', a.src) : null
      pts.add(
        round3(resolveAudioTiming(a, contextDuration.value, src?.duration).enter)
      )
    }
    // the root context lays scenes out as blocks (backdrop in overlay mode,
    // the movie itself in full preview) — their starts are stops too
    if (!activeScene.value && project.doc.scenes?.length && scenePlan.value) {
      for (const e of scenePlan.value.entries) pts.add(round3(e.start))
    }
    return [...pts]
      .filter((t) => t >= 0 && t <= contextDuration.value + 1e-6)
      .sort((a, b) => a - b)
  })

  // half a frame of tolerance so a playhead sitting on a point steps past it
  const eps = computed(() => 0.5 / (project.defaults.frameRate || 30))

  function jumpBack() {
    const t = editor.playhead
    let prev = 0
    for (const p of jumpPoints.value) {
      if (p < t - eps.value) prev = p
      else break
    }
    editor.seek(prev, contextDuration.value)
  }

  function jumpForward() {
    const t = editor.playhead
    const next = jumpPoints.value.find((p) => p > t + eps.value)
    editor.seek(next ?? contextDuration.value, contextDuration.value)
  }

  return { jumpPoints, jumpBack, jumpForward }
}

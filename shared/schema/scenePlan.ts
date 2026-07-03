import type { SceneDoc, ProjectDoc } from './types'
import { canonicalVisualType } from './types'
import {
  DEFAULT_SCENE_DURATION,
  DEFAULT_SCENE_TRANSITION_DURATION,
} from './constants'

/**
 * Client-side port of package/src/lib/scenes (normalizeScenes,
 * computeSceneDuration, buildScenePlan). Probing is injected via
 * `probeDuration` so the editor can use its reactive media cache.
 */

const round2 = (v: number) => Math.round(v * 100) / 100

export interface ScenePlanEntry {
  scene: SceneDoc
  /** resolved effect into the NEXT scene (array-order reconciled) */
  transition: string | null
  transitionDuration: number
  /** resolved duration (auto durations already computed) */
  duration: number
  /** global start offset */
  start: number
  backgroundColor: string
}

export interface ScenePlan {
  entries: ScenePlanEntry[]
  totalScenesDuration: number
}

export type ProbeDurationFn = (src: string) => number | undefined

/** computeSceneDuration port — synchronous, driven by the probe cache. */
export function computeSceneAutoDuration(
  scene: SceneDoc,
  probeDuration: ProbeDurationFn
): number {
  const candidates: number[] = []

  for (const visual of scene.visuals) {
    if (typeof visual.exitEnd === 'number') {
      candidates.push(visual.exitEnd)
      continue
    }
    if (canonicalVisualType(visual.type) !== 'VIDEO') continue
    const begin = visual.videoBegin ?? 0
    const end =
      visual.videoEnd ?? (visual.src ? probeDuration(visual.src) : undefined)
    if (typeof end !== 'number') continue
    candidates.push((visual.enterBegin ?? 0) + (end - begin) / (visual.speed ?? 1))
  }

  for (const audio of scene.audios) {
    if (typeof audio.exit === 'number') {
      candidates.push(audio.exit)
      continue
    }
    const begin = audio.audioBegin ?? 0
    const end =
      audio.audioEnd ?? (audio.src ? probeDuration(audio.src) : undefined)
    if (typeof end !== 'number') continue
    candidates.push((audio.enter ?? 0) + (end - begin) / (audio.speed ?? 1))
  }

  if (!candidates.length) return DEFAULT_SCENE_DURATION
  return round2(Math.max(...candidates))
}

/** normalizeScenes + buildScenePlan port (warnings instead of throws). */
export function buildScenePlan(
  doc: ProjectDoc,
  probeDuration: ProbeDurationFn
): ScenePlan {
  const scenes = doc.scenes ?? []
  const entries: ScenePlanEntry[] = []

  scenes.forEach((scene, index) => {
    const next = scenes[index + 1]
    let transition = scene.transition ?? null
    if (transition && !next) transition = null
    const tid = scene.transitionId
    const pointsToNext =
      tid === undefined || tid === null || tid === 'none' || (next && tid === next.id)
    if (transition && !pointsToNext) transition = null

    const explicit = scene.duration ?? -1
    const duration =
      explicit === -1 || explicit <= 0
        ? computeSceneAutoDuration(scene, probeDuration)
        : explicit

    entries.push({
      scene,
      transition,
      transitionDuration: transition
        ? (scene.transitionDuration ?? DEFAULT_SCENE_TRANSITION_DURATION)
        : 0,
      duration,
      start: 0,
      backgroundColor:
        scene.backgroundColor ?? doc.backgroundColor ?? '#ffffff',
    })
  })

  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1]
    const overlap = prev.transition ? prev.transitionDuration : 0
    entries[i].start = round2(prev.start + prev.duration - overlap)
  }

  const last = entries[entries.length - 1]
  return {
    entries,
    totalScenesDuration: last ? round2(last.start + last.duration) : 0,
  }
}

/** Total preview duration for a project (scenes-aware). */
export function projectTotalDuration(
  doc: ProjectDoc,
  probeDuration: ProbeDurationFn
): number {
  const base = doc.duration ?? 10
  if (doc.scenes?.length) {
    const plan = buildScenePlan(doc, probeDuration)
    return Math.max(base, plan.totalScenesDuration)
  }
  return base
}

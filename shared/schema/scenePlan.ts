import type { SceneDoc, ProjectDoc, VisualDoc, AudioDoc } from './types'
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
export function contentDuration(
  scene: { visuals: VisualDoc[]; audios: AudioDoc[] },
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
    candidates.push(
      (visual.enterBegin ?? 0) + (end - begin) / (visual.speed ?? 1)
    )
  }

  for (const audio of scene.audios) {
    if (audio.matchDuration) continue
    if (typeof audio.exit === 'number') {
      candidates.push(audio.exit)
      continue
    }
    const begin = typeof audio.audioBegin === 'number' ? audio.audioBegin : 0
    const end =
      audio.audioEnd ?? (audio.src ? probeDuration(audio.src) : undefined)
    if (typeof end !== 'number') continue
    const enter = typeof audio.enter === 'number' ? audio.enter : 0
    const speed = typeof audio.speed === 'number' ? audio.speed : 1
    candidates.push(enter + (end - begin) / speed)
  }

  return round2(
    Math.max(0, ...candidates.filter((n) => Number.isFinite(n) && n > 0))
  )
}

export function computeSceneAutoDuration(
  scene: SceneDoc,
  probeDuration: ProbeDurationFn
): number {
  return contentDuration(scene, probeDuration) || DEFAULT_SCENE_DURATION
}

/** Ends authored independently of the container; followers cannot hold it open. */
export function projectContentDuration(
  doc: ProjectDoc,
  probeDuration: ProbeDurationFn
): number {
  const scenes = doc.scenes?.length
    ? buildScenePlan(doc, probeDuration).totalScenesDuration
    : 0
  const captions = (doc.subtitle?.captions ?? [])
    .map((c) => c.end)
    .filter(
      (end): end is number => typeof end === 'number' && Number.isFinite(end)
    )
  return Math.max(scenes, contentDuration(doc, probeDuration), 0, ...captions)
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
    let transition =
      typeof scene.transition === 'string' ? scene.transition : null
    if (transition && !next) transition = null
    const tid = scene.transitionId
    const pointsToNext =
      tid === undefined ||
      tid === null ||
      tid === 'none' ||
      (next && tid === next.id)
    if (transition && !pointsToNext) transition = null

    // Non-numeric durations ("{{sceneLength}}" awaiting resolution) plan as
    // auto so the timeline stays finite; the variables preview resolves them
    // to real numbers before this runs.
    const explicit = typeof scene.duration === 'number' ? scene.duration : -1
    const duration =
      explicit === -1 || explicit <= 0
        ? computeSceneAutoDuration(scene, probeDuration)
        : explicit

    entries.push({
      scene,
      transition,
      transitionDuration: transition
        ? typeof scene.transitionDuration === 'number'
          ? scene.transitionDuration
          : DEFAULT_SCENE_TRANSITION_DURATION
        : 0,
      duration,
      start: 0,
      backgroundColor:
        typeof scene.backgroundColor === 'string'
          ? scene.backgroundColor
          : (doc.backgroundColor ?? '#ffffff'),
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

/** Total preview duration for a project (scenes-aware).
 *
 *  Mirrors package buildSyntheticProject: a scene project runs exactly the
 *  scenes total; an explicit root duration only applies when it is ≥ that
 *  total (extending the movie, e.g. for longer global overlays), and the
 *  10s default duration never applies to scene projects. */
export function projectTotalDuration(
  doc: ProjectDoc,
  probeDuration: ProbeDurationFn
): number {
  if (doc.durationMode === 'auto') {
    const end = projectContentDuration(doc, probeDuration)
    const minimum =
      typeof doc.duration === 'number' && Number.isFinite(doc.duration)
        ? doc.duration
        : 0
    return Math.max(minimum, end) || DEFAULT_SCENE_DURATION
  }
  if (doc.scenes?.length) {
    const plan = buildScenePlan(doc, probeDuration)
    const explicit = typeof doc.duration === 'number' ? doc.duration : undefined
    return explicit !== undefined && explicit >= plan.totalScenesDuration
      ? explicit
      : plan.totalScenesDuration
  }
  return typeof doc.duration === 'number' ? doc.duration : 10
}

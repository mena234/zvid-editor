import {
  XFADE_EFFECTS,
  SUPPORTED_FORMATS,
  SUPPORTED_IMAGE_FORMATS,
  MAX_CUSTOM_CODE_ANIMATION_DURATION,
  MAX_DESIGN_ELEMENT_DURATION,
} from './constants'
import { canonicalVisualType } from './types'
import type { ProjectDoc, VisualDoc, SceneDoc } from './types'
import { resolveVisualTiming, resolveProjectDefaults } from './defaults'

export interface ValidationIssue {
  level: 'error' | 'warning'
  path: string
  message: string
}

const isRemote = (src: string) =>
  /^https?:\/\//i.test(src) || /^data:/i.test(src)

/** "{{placeholder}}" values are resolved by orch before rendering. */
const hasVar = (v: unknown): boolean =>
  typeof v === 'string' && /\{\{[\s\S]*?\}\}/.test(v)

function checkVisual(
  v: VisualDoc,
  path: string,
  contextDuration: number,
  issues: ValidationIssue[]
) {
  const type = canonicalVisualType(v.type)
  if (!type) {
    issues.push({
      level: 'error',
      path,
      message: `Unknown visual type "${v.type}" — must map to VIDEO, IMAGE, GIF, TEXT or SVG.`,
    })
    return
  }

  if ((type === 'VIDEO' || type === 'IMAGE' || type === 'GIF') && !v.src) {
    issues.push({ level: 'error', path, message: `${type} item is missing "src".` })
  }
  if (type === 'SVG' && !v.svg) {
    issues.push({ level: 'error', path, message: 'SVG item is missing "svg" markup.' })
  }
  if (type === 'TEXT' && !v.text && !v.html) {
    issues.push({
      level: 'warning',
      path,
      message: 'TEXT item has neither "text" nor "html" — it will render empty.',
    })
  }
  if (v.src && !isRemote(v.src) && !hasVar(v.src)) {
    issues.push({
      level: 'warning',
      path: `${path}.src`,
      message: `"${v.src}" is a local path — it must exist on the machine that runs the render.`,
    })
  }

  const t = resolveVisualTiming(v, contextDuration)
  const raw = {
    enterBegin: v.enterBegin ?? 0,
    enterEnd: v.enterEnd ?? 0,
    exitBegin: v.exitBegin ?? contextDuration,
    exitEnd: v.exitEnd ?? contextDuration,
  }
  // Ordering checks only apply to concrete numbers — comparing two
  // "{{placeholder}}" strings would be lexicographic noise.
  const timingIsVar =
    hasVar(v.enterBegin) || hasVar(v.enterEnd) || hasVar(v.exitBegin) || hasVar(v.exitEnd)
  if (!timingIsVar && v.enterEnd !== undefined && raw.enterEnd < raw.enterBegin) {
    issues.push({
      level: 'error',
      path,
      message: `enterEnd (${raw.enterEnd}) is before enterBegin (${raw.enterBegin}).`,
    })
  }
  if (!timingIsVar && v.exitBegin !== undefined && v.exitEnd !== undefined && raw.exitBegin > raw.exitEnd) {
    issues.push({
      level: 'error',
      path,
      message: `exitBegin (${raw.exitBegin}) is after exitEnd (${raw.exitEnd}).`,
    })
  }
  if (t.exitEnd <= t.enterBegin) {
    issues.push({
      level: 'error',
      path,
      message: `Item is never visible: exitEnd (${t.exitEnd}) ≤ enterBegin (${t.enterBegin}).`,
    })
  }
  if (t.enterBegin > contextDuration) {
    issues.push({
      level: 'warning',
      path,
      message: `enterBegin (${t.enterBegin}s) is beyond the timeline duration (${contextDuration}s).`,
    })
  }
  if (
    // the cap exemption covers only the two fields the window is made of —
    // a var elsewhere (enterEnd/exitBegin) must not mute the warning
    !hasVar(v.enterBegin) &&
    !hasVar(v.exitEnd) &&
    (v as any).designer &&
    t.exitEnd - t.enterBegin > MAX_DESIGN_ELEMENT_DURATION
  ) {
    issues.push({
      level: 'warning',
      path,
      message: `Design studio elements can stay on screen for at most ${MAX_DESIGN_ELEMENT_DURATION}s (this one runs ${Math.round((t.exitEnd - t.enterBegin) * 100) / 100}s) — the animation freezes past that; shorten the element's window.`,
    })
  }

  for (const key of ['enterAnimation', 'exitAnimation'] as const) {
    const val = v[key]
    if (val && !XFADE_EFFECTS.includes(val as any)) {
      issues.push({
        level: 'error',
        path: `${path}.${key}`,
        message: `Unknown animation "${val}". Must be one of the FFmpeg xfade effects.`,
      })
    }
  }
  if (v.enterAnimation && t.enterEnd <= t.enterBegin) {
    issues.push({
      level: 'warning',
      path,
      message: `enterAnimation "${v.enterAnimation}" has a zero-length window (set enterEnd > enterBegin).`,
    })
  }
  if (v.exitAnimation && t.exitBegin >= t.exitEnd) {
    issues.push({
      level: 'warning',
      path,
      message: `exitAnimation "${v.exitAnimation}" has a zero-length window (set exitBegin < exitEnd).`,
    })
  }
  if (v.exitAnimation && v.transition && v.transitionId) {
    issues.push({
      level: 'warning',
      path,
      message:
        'This video has both an exitAnimation and a transition — the renderer suppresses the exit animation when a transition is set.',
    })
  }
  if (v.transition && !XFADE_EFFECTS.includes(v.transition as any)) {
    issues.push({
      level: 'error',
      path: `${path}.transition`,
      message: `Unknown transition "${v.transition}".`,
    })
  }

  const cc = v.customCode
  if (cc?.animationDuration !== undefined) {
    if (cc.animationDuration > MAX_CUSTOM_CODE_ANIMATION_DURATION) {
      issues.push({
        level: 'error',
        path: `${path}.customCode.animationDuration`,
        message: `animationDuration must be ≤ ${MAX_CUSTOM_CODE_ANIMATION_DURATION}s (got ${cc.animationDuration}).`,
      })
    } else if (cc.animationDuration <= 0) {
      issues.push({
        level: 'error',
        path: `${path}.customCode.animationDuration`,
        message: 'animationDuration must be positive.',
      })
    }
  }
  if (cc?.js && /\b(fetch|XMLHttpRequest|localStorage|sessionStorage|indexedDB|location\s*=|window\.open|import\s*\()/i.test(cc.js)) {
    issues.push({
      level: 'warning',
      path: `${path}.customCode.js`,
      message:
        'customCode.js appears to use network/storage/navigation APIs — the renderer rejects those at render time.',
    })
  }

  if (v.opacity !== undefined && (v.opacity < 0 || v.opacity > 1)) {
    issues.push({
      level: 'error',
      path: `${path}.opacity`,
      message: `opacity must be between 0 and 1 (got ${v.opacity}).`,
    })
  }
  if (type === 'VIDEO') {
    if (v.volume !== undefined && v.volume < 0) {
      issues.push({ level: 'error', path, message: 'volume must be ≥ 0.' })
    }
    if (v.speed !== undefined && v.speed <= 0) {
      issues.push({ level: 'error', path, message: 'speed must be > 0.' })
    }
    if (
      v.videoBegin !== undefined &&
      v.videoEnd !== undefined &&
      !hasVar(v.videoBegin) &&
      !hasVar(v.videoEnd) &&
      v.videoEnd <= v.videoBegin
    ) {
      issues.push({
        level: 'error',
        path,
        message: `videoEnd (${v.videoEnd}) must be after videoBegin (${v.videoBegin}).`,
      })
    }
  }
}

function checkScene(
  scene: SceneDoc,
  index: number,
  scenes: SceneDoc[],
  issues: ValidationIssue[]
) {
  const path = `scenes[${index}]`
  const duration = scene.duration ?? -1
  if (typeof duration === 'string') {
    if (!hasVar(duration)) {
      issues.push({
        level: 'error',
        path,
        message: `Scene duration must be a number, -1 for auto, or a {{placeholder}} (got "${duration}").`,
      })
    }
  } else if (duration !== -1 && duration <= 0) {
    issues.push({
      level: 'error',
      path,
      message: `Scene duration must be positive or -1 for auto (got ${duration}).`,
    })
  }

  const next = scenes[index + 1]
  if (scene.transition) {
    if (!XFADE_EFFECTS.includes(scene.transition as any)) {
      issues.push({
        level: 'error',
        path: `${path}.transition`,
        message: `Unknown transition "${scene.transition}".`,
      })
    }
    if (!next) {
      issues.push({
        level: 'warning',
        path,
        message: 'Last scene defines a transition — the renderer ignores it.',
      })
    } else if (
      scene.transitionId != null &&
      scene.transitionId !== 'none' &&
      scene.transitionId !== next.id
    ) {
      issues.push({
        level: 'warning',
        path: `${path}.transitionId`,
        message: `transitionId "${scene.transitionId}" doesn't match the next scene's id "${next.id}" — the renderer falls back to a hard cut.`,
      })
    }
    if (scene.transitionDuration !== undefined && scene.transitionDuration <= 0) {
      issues.push({
        level: 'error',
        path: `${path}.transitionDuration`,
        message: 'transitionDuration must be greater than 0.',
      })
    }
  }

  const ids = scenes.map((s) => s.id)
  if (ids.filter((i) => i === scene.id).length > 1) {
    issues.push({
      level: 'error',
      path: `${path}.id`,
      message: `Duplicate scene id "${scene.id}".`,
    })
  }
}

/** Image projects reject all time-domain fields (plan D1/D2) — mirror of
 *  orch's validation branch so errors surface before submission. */
function checkImageProject(doc: ProjectDoc, issues: ValidationIssue[]) {
  const fmt = (doc.outputFormat ?? 'png').toLowerCase()
  if (!SUPPORTED_IMAGE_FORMATS.includes(fmt as any)) {
    issues.push({
      level: 'error',
      path: 'outputFormat',
      message: `Unsupported image format "${doc.outputFormat}". Allowed: ${SUPPORTED_IMAGE_FORMATS.join(', ')}.`,
    })
  }
  const forbidden: [string, unknown][] = [
    ['duration', doc.duration],
    ['frameRate', doc.frameRate],
    ['thumbnail', doc.thumbnail || undefined],
  ]
  for (const [key, value] of forbidden) {
    if (value !== undefined) {
      issues.push({
        level: 'error',
        path: key,
        message: `"${key}" is not applicable to image renders — remove it.`,
      })
    }
  }
  if (doc.audios.length) {
    issues.push({
      level: 'error',
      path: 'audios',
      message: 'Audio tracks are not applicable to image renders.',
    })
  }
  if (doc.scenes?.length) {
    issues.push({
      level: 'error',
      path: 'scenes',
      message: 'Scenes are not applicable to image renders.',
    })
  }
  if (doc.subtitle?.captions?.length || doc.subtitle?.styles) {
    issues.push({
      level: 'error',
      path: 'subtitle',
      message: 'Subtitles are not applicable to image renders.',
    })
  }
  if (doc.transparent === true && (fmt === 'jpg' || fmt === 'jpeg')) {
    issues.push({
      level: 'error',
      path: 'transparent',
      message: 'transparent is not supported with jpg output (no alpha channel) — use png or webp.',
    })
  }
  if (doc.quality !== undefined) {
    if (fmt === 'png') {
      issues.push({
        level: 'error',
        path: 'quality',
        message: 'quality applies to jpg/webp outputs only (png is lossless).',
      })
    } else if (doc.quality < 1 || doc.quality > 100) {
      issues.push({
        level: 'error',
        path: 'quality',
        message: `quality must be between 1 and 100 (got ${doc.quality}).`,
      })
    }
  }
  if (doc.snapshotTime !== undefined && doc.snapshotTime < 0) {
    issues.push({
      level: 'error',
      path: 'snapshotTime',
      message: 'snapshotTime cannot be negative.',
    })
  }

  doc.visuals.forEach((v, i) => {
    const path = `visuals[${i}]`
    const type = canonicalVisualType(v.type)
    if (type === 'VIDEO' || type === 'GIF') {
      issues.push({
        level: 'error',
        path,
        message: `${type} elements are not allowed in image projects — static sources only (image/text/svg/shape/design).`,
      })
    }
    for (const key of [
      'enterBegin',
      'enterEnd',
      'exitBegin',
      'exitEnd',
      'enterAnimation',
      'exitAnimation',
      'transition',
      'transitionId',
      'transitionDuration',
    ]) {
      const val = (v as any)[key]
      if (val !== undefined && val !== null) {
        issues.push({
          level: 'error',
          path: `${path}.${key}`,
          message: `"${key}" is a timing field — not applicable to image renders (everything is always on).`,
        })
      }
    }
  })
}

export function validateProjectDoc(doc: ProjectDoc): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const defaults = resolveProjectDefaults(doc)
  const isImage = doc.type === 'image'

  if (doc.type !== undefined && doc.type !== 'video' && doc.type !== 'image') {
    issues.push({
      level: 'error',
      path: 'type',
      message: `Project type must be "video" or "image" (got "${doc.type}").`,
    })
  }
  if (isImage) checkImageProject(doc, issues)

  if (
    !isImage &&
    doc.outputFormat &&
    !SUPPORTED_FORMATS.includes(doc.outputFormat.toLowerCase() as any)
  ) {
    issues.push({
      level: 'error',
      path: 'outputFormat',
      message: `Unsupported format "${doc.outputFormat}". Allowed: ${SUPPORTED_FORMATS.join(', ')}.`,
    })
  }
  if (!isImage) {
    for (const key of ['snapshotTime', 'quality', 'transparent'] as const) {
      if (doc[key] !== undefined) {
        issues.push({
          level: 'error',
          path: key,
          message: `"${key}" is only applicable to image renders (type: "image").`,
        })
      }
    }
  }
  if (!isImage && doc.duration !== undefined && doc.duration <= 0) {
    issues.push({ level: 'error', path: 'duration', message: 'duration must be > 0.' })
  }
  if (!isImage && doc.frameRate !== undefined && (doc.frameRate <= 0 || doc.frameRate > 120)) {
    issues.push({
      level: 'error',
      path: 'frameRate',
      message: 'frameRate must be between 1 and 120.',
    })
  }
  if ((doc.resolution === 'custom' || !doc.resolution) && (!doc.width || !doc.height)) {
    issues.push({
      level: 'warning',
      path: 'resolution',
      message:
        'Custom resolution without explicit width/height — the renderer will fall back to defaults.',
    })
  }
  if (doc.backgroundColor && !/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(doc.backgroundColor)) {
    issues.push({
      level: 'warning',
      path: 'backgroundColor',
      message: `"${doc.backgroundColor}" is not a hex color — FFmpeg color parsing may fail.`,
    })
  }

  // root visuals of a scenes project overlay the WHOLE movie — resolve their
  // open-ended timing against the total, not the (often unset) doc duration
  const rootDuration = doc.scenes?.length
    ? Math.max(
        defaults.duration,
        doc.scenes.reduce(
          (sum, s) =>
            sum +
            (typeof s.duration === 'number' && s.duration > 0
              ? s.duration
              : defaults.duration),
          0
        )
      )
    : defaults.duration
  doc.visuals.forEach((v, i) =>
    checkVisual(v, `visuals[${i}]`, rootDuration, issues)
  )
  doc.audios.forEach((a, i) => {
    if (!a.src)
      issues.push({ level: 'error', path: `audios[${i}]`, message: 'Audio item is missing "src".' })
    else if (!isRemote(a.src))
      issues.push({
        level: 'warning',
        path: `audios[${i}].src`,
        message: `"${a.src}" is a local path — it must exist on the render machine.`,
      })
    if (
      a.exit !== undefined &&
      a.enter !== undefined &&
      !hasVar(a.exit) &&
      !hasVar(a.enter) &&
      a.exit <= a.enter
    ) {
      issues.push({
        level: 'error',
        path: `audios[${i}]`,
        message: `exit (${a.exit}) must be after enter (${a.enter}).`,
      })
    }
    if (
      a.audioEnd !== undefined &&
      !hasVar(a.audioEnd) &&
      !hasVar(a.audioBegin) &&
      (a.audioBegin ?? 0) >= a.audioEnd
    ) {
      issues.push({
        level: 'error',
        path: `audios[${i}]`,
        message: `audioEnd (${a.audioEnd}) must be after audioBegin (${a.audioBegin ?? 0}).`,
      })
    }
  })

  doc.scenes?.forEach((s, i) => {
    checkScene(s, i, doc.scenes!, issues)
    const sceneDuration = s.duration && s.duration > 0 ? s.duration : defaults.duration
    const sceneIsAuto = !(typeof s.duration === 'number' && s.duration > 0)
    s.visuals.forEach((v, j) => {
      checkVisual(v, `scenes[${i}].visuals[${j}]`, sceneDuration, issues)
      // an auto scene's real length comes from media probes, so an
      // open-ended design window cannot be checked against the 15s cap here
      if (
        sceneIsAuto &&
        (v as any).designer &&
        v.exitEnd === undefined &&
        !hasVar(v.enterBegin)
      ) {
        issues.push({
          level: 'warning',
          path: `scenes[${i}].visuals[${j}]`,
          message: `Design studio element has no explicit end inside an auto-duration scene — the ${MAX_DESIGN_ELEMENT_DURATION}s cap cannot be verified; set "exitEnd".`,
        })
      }
    })
  })

  const captions = doc.subtitle?.captions ?? []
  captions.forEach((c, i) => {
    if (c.end <= c.start) {
      issues.push({
        level: 'error',
        path: `subtitle.captions[${i}]`,
        message: `Caption end (${c.end}) must be after start (${c.start}).`,
      })
    }
    c.words?.forEach((w, j) => {
      if (w.start < c.start - 0.001 || w.end > c.end + 0.001) {
        issues.push({
          level: 'warning',
          path: `subtitle.captions[${i}].words[${j}]`,
          message: `Word "${w.text}" (${w.start}–${w.end}) is outside its caption bounds (${c.start}–${c.end}).`,
        })
      }
      if (w.end < w.start) {
        issues.push({
          level: 'error',
          path: `subtitle.captions[${i}].words[${j}]`,
          message: `Word "${w.text}" ends before it starts.`,
        })
      }
    })
  })

  return issues
}

import { z } from 'zod'
import {
  XFADE_EFFECTS,
  SUPPORTED_FORMATS,
  POSITION_PRESETS,
  ANCHORS,
  SUBTITLE_POSITIONS,
  SUBTITLE_MODES,
  RESOLUTION_PRESET_NAMES,
} from './constants'

/**
 * Zod schemas mirroring package/src/types/items.type.ts + text.ts.
 * All object schemas use .passthrough() so unknown/extra fields survive a
 * round-trip untouched (the package itself ignores unknown fields).
 */

const num = z.number()
const numOpt = z.number().optional()
const boolOpt = z.boolean().optional()
const strOpt = z.string().optional()

export const xfadeEffectSchema = z.enum(XFADE_EFFECTS)
export const positionPresetSchema = z.enum(POSITION_PRESETS)
export const anchorSchema = z.enum(ANCHORS)
export const resizeModeSchema = z.enum(['contain', 'cover'])

// Animations arrive as free strings in the wild; validation report flags
// unknown names instead of hard-failing the import.
const animationField = z.string().nullable().optional()

export const customCodeSchema = z
  .object({
    css: strOpt,
    js: strOpt,
    animationDuration: numOpt,
  })
  .passthrough()

export const cropParamsSchema = z
  .object({ x: num, y: num, width: num, height: num })
  .passthrough()

export const chromaKeySchema = z
  .object({ color: z.string(), similarity: numOpt, blend: numOpt })
  .passthrough()

export const radiusSchema = z
  .object({ tl: num, tr: num, bl: num, br: num })
  .passthrough()

export const filterSchema = z
  .object({
    brightness: numOpt,
    contrast: numOpt,
    saturate: numOpt,
    'hue-rotate': strOpt,
    blur: z.union([z.string(), z.number()]).optional(),
    invert: z.union([z.boolean(), z.number()]).optional(),
    colorTint: strOpt,
  })
  .passthrough()

/** zoom is `boolean` in the type but the filter reads `{ depth }` too. */
export const zoomSchema = z.union([
  z.boolean(),
  z.object({ depth: numOpt }).passthrough(),
])

const commonVisualFields = {
  x: numOpt,
  y: numOpt,
  width: numOpt,
  height: numOpt,
  track: numOpt,
  opacity: numOpt,
  angle: numOpt,
  flipV: boolOpt,
  flipH: boolOpt,
  enterBegin: numOpt,
  enterEnd: numOpt,
  exitBegin: numOpt,
  exitEnd: numOpt,
  enterAnimation: animationField,
  exitAnimation: animationField,
  position: positionPresetSchema.optional(),
  anchor: anchorSchema.optional(),
  inputNumber: numOpt,
}

export const imageItemSchema = z
  .object({
    type: z.string(),
    src: z.string().optional().default(''),
    ...commonVisualFields,
    cropParams: cropParamsSchema.optional(),
    chromaKey: chromaKeySchema.optional(),
    radius: radiusSchema.optional(),
    filter: filterSchema.optional(),
    resize: resizeModeSchema.optional(),
    zoom: zoomSchema.optional(),
  })
  .passthrough()

export const videoItemSchema = imageItemSchema
  .extend({
    videoBegin: numOpt,
    videoEnd: numOpt,
    videoDuration: numOpt,
    volume: numOpt,
    speed: numOpt,
    transition: z.string().nullable().optional(),
    transitionId: z.string().nullable().optional(),
    transitionDuration: numOpt,
    frameRate: numOpt,
    id: strOpt,
    hasAudio: boolOpt,
  })
  .passthrough()

export const gifItemSchema = z
  .object({
    type: z.string(),
    src: z.string().optional().default(''),
    ...commonVisualFields,
    cropParams: cropParamsSchema.optional(),
    resize: resizeModeSchema.optional(),
    zoom: zoomSchema.optional(),
    speed: numOpt,
  })
  .passthrough()

export const textItemSchema = z
  .object({
    type: z.string(),
    text: strOpt,
    html: strOpt,
    style: z.record(z.string(), z.any()).optional(),
    customCode: customCodeSchema.optional(),
    imageSrc: strOpt,
    ...commonVisualFields,
  })
  .passthrough()

export const svgItemSchema = z
  .object({
    type: z.string(),
    svg: z.string().optional().default(''),
    customCode: customCodeSchema.optional(),
    imageSrc: strOpt,
    filter: filterSchema.optional(),
    chromaKey: chromaKeySchema.optional(),
    resize: resizeModeSchema.optional(),
    zoom: zoomSchema.optional(),
    ...commonVisualFields,
  })
  .passthrough()

/**
 * A visual item — dispatched on `type` with the same loose semantics as the
 * package (`checking.ts`): /vide?o?/i → video, exact GIF/TEXT/SVG, /ima?ge?/i → image.
 */
export const visualItemSchema = z
  .object({ type: z.string() })
  .passthrough()
  .superRefine((item, ctx) => {
    const schema = schemaForType(String(item.type))
    if (!schema) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unknown visual type "${item.type}" (expected VIDEO, IMAGE, GIF, TEXT or SVG)`,
      })
      return
    }
    const res = schema.safeParse(item)
    if (!res.success) {
      for (const issue of res.error.issues) {
        ctx.addIssue({ ...issue, path: [...issue.path] })
      }
    }
  })

export function canonicalVisualType(
  type: string
): 'VIDEO' | 'IMAGE' | 'GIF' | 'TEXT' | 'SVG' | null {
  const t = String(type || '').toUpperCase()
  if (t === 'SVG') return 'SVG'
  if (t === 'GIF') return 'GIF'
  if (t === 'TEXT') return 'TEXT'
  if (/vide?o?/i.test(t)) return 'VIDEO'
  if (/ima?ge?/i.test(t)) return 'IMAGE'
  return null
}

function schemaForType(type: string) {
  switch (canonicalVisualType(type)) {
    case 'VIDEO':
      return videoItemSchema
    case 'IMAGE':
      return imageItemSchema
    case 'GIF':
      return gifItemSchema
    case 'TEXT':
      return textItemSchema
    case 'SVG':
      return svgItemSchema
    default:
      return null
  }
}

export const audioItemSchema = z
  .object({
    src: z.string(),
    enter: numOpt,
    exit: numOpt,
    audioBegin: numOpt,
    audioEnd: numOpt,
    audioDuration: numOpt,
    volume: numOpt,
    speed: numOpt,
    track: numOpt,
  })
  .passthrough()

export const wordSchema = z
  .object({ start: num, end: num, text: z.string() })
  .passthrough()

export const captionSchema = z
  .object({
    start: num,
    end: num,
    text: strOpt,
    words: z.array(wordSchema).default([]),
  })
  .passthrough()

export const subtitleStylesSchema = z
  .object({
    color: strOpt,
    background: strOpt,
    isBold: boolOpt,
    isItalic: boolOpt,
    fontSize: numOpt,
    fontFamily: strOpt,
    textTransform: z.enum(['uppercase', 'lowercase', 'capitalize']).optional(),
    outline: z.object({ width: num, color: z.string() }).passthrough().optional(),
    position: z.enum(SUBTITLE_POSITIONS).optional(),
    marginV: numOpt,
    marginH: numOpt,
    mode: z.enum(SUBTITLE_MODES).optional(),
    activeWord: z.object({ color: z.string() }).passthrough().optional(),
  })
  .passthrough()

export const subtitleSchema = z
  .object({
    captions: z.array(captionSchema).default([]),
    styles: subtitleStylesSchema.optional(),
  })
  .passthrough()

export const sceneSchema = z
  .object({
    id: strOpt,
    visuals: z.array(visualItemSchema).optional(),
    audios: z.array(audioItemSchema).optional(),
    duration: numOpt,
    transition: z.string().nullable().optional(),
    transitionId: z.string().nullable().optional(),
    transitionDuration: numOpt,
    backgroundColor: strOpt,
  })
  .passthrough()

export const projectSchema = z
  .object({
    name: strOpt,
    resolution: z.enum(RESOLUTION_PRESET_NAMES as [string, ...string[]]).optional(),
    width: numOpt,
    height: numOpt,
    duration: numOpt,
    frameRate: numOpt,
    backgroundColor: strOpt,
    outputFormat: strOpt,
    thumbnail: strOpt,
    visuals: z.array(visualItemSchema).optional(),
    audios: z.array(audioItemSchema).optional(),
    subtitle: subtitleSchema.optional(),
    scenes: z.array(sceneSchema).optional(),
  })
  .passthrough()

/* ------------------------------------------------------------------ */
/* Inferred raw (wire-format) types                                    */
/* ------------------------------------------------------------------ */

export type RawImageItem = z.infer<typeof imageItemSchema>
export type RawVideoItem = z.infer<typeof videoItemSchema>
export type RawGifItem = z.infer<typeof gifItemSchema>
export type RawTextItem = z.infer<typeof textItemSchema>
export type RawSvgItem = z.infer<typeof svgItemSchema>
export type RawVisualItem = Record<string, any> & { type: string }
export type RawAudioItem = z.infer<typeof audioItemSchema>
export type RawCaption = z.infer<typeof captionSchema>
export type RawWord = z.infer<typeof wordSchema>
export type RawSubtitle = z.infer<typeof subtitleSchema>
export type RawSubtitleStyles = z.infer<typeof subtitleStylesSchema>
export type RawScene = z.infer<typeof sceneSchema>
export type RawProject = z.infer<typeof projectSchema>

/* ------------------------------------------------------------------ */
/* Editor document types (raw + stable editor ids)                     */
/* ------------------------------------------------------------------ */

export type VisualDoc = RawVisualItem & { _id: string }
export type AudioDoc = RawAudioItem & { _id: string }
export type SceneDoc = Omit<RawScene, 'visuals' | 'audios'> & {
  _id: string
  visuals: VisualDoc[]
  audios: AudioDoc[]
}

export interface ProjectDoc {
  name?: string
  resolution?: string
  width?: number
  height?: number
  duration?: number
  frameRate?: number
  backgroundColor?: string
  outputFormat?: string
  thumbnail?: string
  visuals: VisualDoc[]
  audios: AudioDoc[]
  subtitle?: RawSubtitle
  scenes?: SceneDoc[]
  /** unknown project-level fields preserved for round-trip */
  extra?: Record<string, any>
}

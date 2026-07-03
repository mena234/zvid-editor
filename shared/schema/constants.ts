/**
 * Constants mirrored from package/src/constants + formatValidator.
 * Keep in sync with the rendering package — this file is the contract.
 */

export const XFADE_EFFECTS = [
  'fade',
  'fadeblack',
  'fadewhite',
  'distance',
  'wipeleft',
  'wiperight',
  'wipeup',
  'wipedown',
  'slideleft',
  'slideright',
  'slideup',
  'slidedown',
  'smoothleft',
  'smoothright',
  'smoothup',
  'smoothdown',
  'circlecrop',
  'rectcrop',
  'circleclose',
  'circleopen',
  'horzclose',
  'horzopen',
  'vertclose',
  'vertopen',
  'diagbl',
  'diagbr',
  'diagtl',
  'diagtr',
  'hlslice',
  'hrslice',
  'vuslice',
  'vdslice',
  'dissolve',
  'pixelize',
  'radial',
  'hblur',
  'wipetl',
  'wipetr',
  'wipebl',
  'wipebr',
  'fadegrays',
  'zoomin',
  'hlwind',
  'hrwind',
] as const

export type XFadeEffect = (typeof XFADE_EFFECTS)[number]

/** Groups used by the animation picker UI. */
export const XFADE_GROUPS: Record<string, XFadeEffect[]> = {
  Fades: ['fade', 'fadeblack', 'fadewhite', 'fadegrays', 'dissolve', 'distance'],
  Slides: ['slideleft', 'slideright', 'slideup', 'slidedown'],
  Wipes: [
    'wipeleft',
    'wiperight',
    'wipeup',
    'wipedown',
    'wipetl',
    'wipetr',
    'wipebl',
    'wipebr',
  ],
  Smooth: ['smoothleft', 'smoothright', 'smoothup', 'smoothdown'],
  Geometric: [
    'circlecrop',
    'rectcrop',
    'circleclose',
    'circleopen',
    'horzclose',
    'horzopen',
    'vertclose',
    'vertopen',
  ],
  Diagonal: ['diagbl', 'diagbr', 'diagtl', 'diagtr'],
  Slices: ['hlslice', 'hrslice', 'vuslice', 'vdslice', 'hlwind', 'hrwind'],
  Misc: ['pixelize', 'radial', 'hblur', 'zoomin'],
}

export const RESOLUTION_PRESETS = {
  sd: { width: 640, height: 480 },
  hd: { width: 1280, height: 720 },
  'full-hd': { width: 1920, height: 1080 },
  squared: { width: 1080, height: 1080 },
  'youtube-short': { width: 1080, height: 1920 },
  'youtube-video': { width: 1920, height: 1080 },
  tiktok: { width: 1080, height: 1920 },
  'instagram-reel': { width: 1080, height: 1920 },
  'instagram-post': { width: 1080, height: 1080 },
  'instagram-story': { width: 1080, height: 1920 },
  'instagram-feed': { width: 1080, height: 1080 },
  'twitter-landscape': { width: 1200, height: 675 },
  'twitter-portrait': { width: 1080, height: 1350 },
  'twitter-square': { width: 1080, height: 1080 },
  'facebook-video': { width: 1080, height: 1920 },
  'facebook-story': { width: 1080, height: 1920 },
  'facebook-post': { width: 1080, height: 1080 },
  snapshat: { width: 1080, height: 1920 },
  custom: null,
} as const

export type ResolutionPreset = keyof typeof RESOLUTION_PRESETS

export const RESOLUTION_PRESET_NAMES = Object.keys(
  RESOLUTION_PRESETS
) as ResolutionPreset[]

export const SUPPORTED_FORMATS = [
  'mp4',
  'mkv',
  'avi',
  'mov',
  'webm',
  'flv',
  'wmv',
  'ogv',
  'm4v',
  '3gp',
  'asf',
  'f4v',
  'ts',
  'mts',
  'm2ts',
] as const

export type SupportedFormat = (typeof SUPPORTED_FORMATS)[number]

export const POSITION_PRESETS = [
  'top-left',
  'top-center',
  'top-right',
  'center-left',
  'center-center',
  'center-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
  'custom',
] as const

export type PositionPreset = (typeof POSITION_PRESETS)[number]

export const ANCHORS = [
  'top-left',
  'top-center',
  'top-right',
  'center-left',
  'center-center',
  'center-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
] as const

export type Anchor = (typeof ANCHORS)[number]

/**
 * The published SubtitleStyles type lists 7 positions, but the package's
 * mapPositionToASS also resolves 'top-center' (alignment 8) at runtime —
 * kept here so ASS imports round-trip.
 */
export const SUBTITLE_POSITIONS = [
  'top-left',
  'top-center',
  'top-right',
  'bottom-left',
  'bottom-right',
  'center-center',
  'center-left',
  'center-right',
] as const

export const SUBTITLE_MODES = [
  'normal',
  'one-word',
  'karaoke',
  'progressive',
] as const

export const VISUAL_TYPES = ['VIDEO', 'IMAGE', 'GIF', 'TEXT', 'SVG'] as const
export type VisualType = (typeof VISUAL_TYPES)[number]

/** Package-level defaults (extractProjectDefaults + applyItemDefaults). */
export const PROJECT_DEFAULTS = {
  name: 'unnamed',
  duration: 10,
  frameRate: 30,
  backgroundColor: '#ffffff',
  outputFormat: 'mp4',
} as const

export const MAX_CUSTOM_CODE_ANIMATION_DURATION = 15
export const DEFAULT_SCENE_TRANSITION_DURATION = 0.5
export const DEFAULT_SCENE_DURATION = 10
export const TEXT_DEFAULT_FONT_FAMILY = 'Poppins'
export const TEXT_DEFAULT_FONT_SIZE = '42px'

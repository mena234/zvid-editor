/**
 * Presentation metadata for the xfade effect gallery (EffectPicker /
 * EffectTile). The effect *ids* are the schema contract (see
 * shared/schema/constants XFADE_EFFECTS) — these are only display labels and
 * the shared-clock injection key, kept out of the contract file on purpose.
 */
import type { InjectionKey, Ref } from 'vue'

/**
 * A single animation clock (progress 0→1, looping) shared by every tile in a
 * picker so they animate in sync off one requestAnimationFrame instead of one
 * loop per tile.
 */
export const EFFECT_CLOCK: InjectionKey<Ref<number>> = Symbol('zvid-effect-clock')

/** Short, arrow-annotated labels — compact enough for a 3-column grid cell. */
const EFFECT_LABELS: Record<string, string> = {
  // Fades
  fade: 'Fade',
  fadeblack: 'To black',
  fadewhite: 'To white',
  fadegrays: 'To gray',
  dissolve: 'Dissolve',
  distance: 'Distance',
  // Slides
  slideleft: 'Slide ←',
  slideright: 'Slide →',
  slideup: 'Slide ↑',
  slidedown: 'Slide ↓',
  // Wipes
  wipeleft: 'Wipe ←',
  wiperight: 'Wipe →',
  wipeup: 'Wipe ↑',
  wipedown: 'Wipe ↓',
  wipetl: 'Wipe ↖',
  wipetr: 'Wipe ↗',
  wipebl: 'Wipe ↙',
  wipebr: 'Wipe ↘',
  // Smooth
  smoothleft: 'Smooth ←',
  smoothright: 'Smooth →',
  smoothup: 'Smooth ↑',
  smoothdown: 'Smooth ↓',
  // Geometric
  circlecrop: 'Circle crop',
  rectcrop: 'Rect crop',
  circleclose: 'Circle in',
  circleopen: 'Circle out',
  horzclose: 'Horz close',
  horzopen: 'Horz open',
  vertclose: 'Vert close',
  vertopen: 'Vert open',
  // Diagonal
  diagbl: 'Diag ↙',
  diagbr: 'Diag ↘',
  diagtl: 'Diag ↖',
  diagtr: 'Diag ↗',
  // Slices
  hlslice: 'Slice ←',
  hrslice: 'Slice →',
  vuslice: 'Slice ↑',
  vdslice: 'Slice ↓',
  hlwind: 'Wind ←',
  hrwind: 'Wind →',
  // Misc
  pixelize: 'Pixelize',
  radial: 'Radial',
  hblur: 'Blur',
  zoomin: 'Zoom in',
}

/** Human label for an effect id; falls back to a humanized id for imports. */
export function effectLabel(effect: string): string {
  return (
    EFFECT_LABELS[effect] ??
    effect
      .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
      .replace(/^\w/, (c) => c.toUpperCase())
  )
}

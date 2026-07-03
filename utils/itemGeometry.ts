import type { VisualDoc } from '~/shared/schema/types'
import { canonicalVisualType } from '~/shared/schema/types'
import {
  resolveVisualLayout,
  resolveVisualTiming,
  type ResolvedLayout,
} from '~/shared/schema/defaults'
import { useMediaProbe } from '~/composables/useMediaProbe'
import { useMeasuredDims } from '~/composables/useMeasuredDims'

/**
 * Effective geometry of a visual on the stage: package default resolution +
 * probed intrinsic media dims + editor-measured text/svg dims.
 */
export function effectiveLayout(
  item: VisualDoc,
  projectWidth: number,
  projectHeight: number
): ResolvedLayout {
  const { intrinsicOf } = useMediaProbe()
  const { getMeasured } = useMeasuredDims()

  const type = canonicalVisualType(item.type)
  let intrinsic: { width: number; height: number } | null = null

  if (type === 'VIDEO') intrinsic = item.src ? intrinsicOf('video', item.src) : null
  else if (type === 'IMAGE' || type === 'GIF')
    intrinsic = item.src ? intrinsicOf('image', item.src) : null
  else if (type === 'TEXT' || type === 'SVG') intrinsic = getMeasured(item._id)

  // cropParams redefine the source rect; the item w/h defaults to the crop size
  if ((type === 'VIDEO' || type === 'IMAGE' || type === 'GIF') && item.cropParams) {
    intrinsic = { width: item.cropParams.width, height: item.cropParams.height }
  }

  return resolveVisualLayout(item, projectWidth, projectHeight, intrinsic)
}

export function isVisibleAt(item: VisualDoc, t: number, contextDuration: number) {
  const timing = resolveVisualTiming(item, contextDuration)
  return t >= timing.enterBegin && t <= timing.exitEnd
}

export { resolveVisualTiming }

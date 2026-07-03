/**
 * CSS approximations of FFmpeg xfade effects for enter/exit animation
 * preview. `p` is the animation progress: 0 = fully hidden, 1 = fully shown
 * (for exits the caller passes the reversed progress).
 *
 * Returns style fields merged onto the item wrapper. clipPath/opacity/
 * transform compose with the item's own layout transform via a dedicated
 * animation wrapper element.
 */
export interface AnimStyle {
  opacity?: number
  clipPath?: string
  transform?: string
  filter?: string
}

const pct = (v: number) => `${(v * 100).toFixed(2)}%`

export function xfadeToCss(effect: string, p: number): AnimStyle {
  p = Math.min(1, Math.max(0, p))
  const q = 1 - p
  switch (effect) {
    case 'fade':
    case 'dissolve':
    case 'distance':
      return { opacity: p }
    case 'fadeblack':
      return { opacity: p, filter: `brightness(${p})` }
    case 'fadewhite':
      return { opacity: p, filter: `brightness(${1 + q * 2})` }
    case 'fadegrays':
      return { opacity: p, filter: `grayscale(${q})` }

    case 'wipeleft':
      return { clipPath: `inset(0 ${pct(q)} 0 0)` }
    case 'wiperight':
      return { clipPath: `inset(0 0 0 ${pct(q)})` }
    case 'wipeup':
      return { clipPath: `inset(${pct(q)} 0 0 0)` }
    case 'wipedown':
      return { clipPath: `inset(0 0 ${pct(q)} 0)` }
    case 'wipetl':
      return { clipPath: `polygon(0 0, ${pct(p)} 0, ${pct(p)} ${pct(p)}, 0 ${pct(p)})` }
    case 'wipetr':
      return {
        clipPath: `polygon(${pct(q)} 0, 100% 0, 100% ${pct(p)}, ${pct(q)} ${pct(p)})`,
      }
    case 'wipebl':
      return {
        clipPath: `polygon(0 ${pct(q)}, ${pct(p)} ${pct(q)}, ${pct(p)} 100%, 0 100%)`,
      }
    case 'wipebr':
      return {
        clipPath: `polygon(${pct(q)} ${pct(q)}, 100% ${pct(q)}, 100% 100%, ${pct(q)} 100%)`,
      }

    case 'slideleft':
      return { transform: `translateX(${pct(q)})` }
    case 'slideright':
      return { transform: `translateX(${pct(-q)})` }
    case 'slideup':
      return { transform: `translateY(${pct(q)})` }
    case 'slidedown':
      return { transform: `translateY(${pct(-q)})` }

    case 'smoothleft':
      return { transform: `translateX(${pct(q * 0.4)})`, opacity: p }
    case 'smoothright':
      return { transform: `translateX(${pct(-q * 0.4)})`, opacity: p }
    case 'smoothup':
      return { transform: `translateY(${pct(q * 0.4)})`, opacity: p }
    case 'smoothdown':
      return { transform: `translateY(${pct(-q * 0.4)})`, opacity: p }

    case 'circleopen':
      return { clipPath: `circle(${pct(p * 0.75)} at 50% 50%)` }
    case 'circleclose':
      return { clipPath: `circle(${pct(p * 0.75)} at 50% 50%)` }
    case 'circlecrop':
      return { clipPath: `circle(${pct(p * 0.75)} at 50% 50%)`, opacity: p }
    case 'rectcrop':
      return {
        clipPath: `inset(${pct(q / 2)} ${pct(q / 2)} ${pct(q / 2)} ${pct(q / 2)})`,
      }
    case 'horzopen':
      return { clipPath: `inset(${pct(q / 2)} 0 ${pct(q / 2)} 0)` }
    case 'horzclose':
      return { clipPath: `inset(${pct(q / 2)} 0 ${pct(q / 2)} 0)` }
    case 'vertopen':
      return { clipPath: `inset(0 ${pct(q / 2)} 0 ${pct(q / 2)})` }
    case 'vertclose':
      return { clipPath: `inset(0 ${pct(q / 2)} 0 ${pct(q / 2)})` }

    case 'diagtl':
      return { clipPath: `polygon(0 0, ${pct(p * 2)} 0, 0 ${pct(p * 2)})` }
    case 'diagtr':
      return {
        clipPath: `polygon(100% 0, ${pct(1 - p * 2)} 0, 100% ${pct(p * 2)})`,
      }
    case 'diagbl':
      return {
        clipPath: `polygon(0 100%, ${pct(p * 2)} 100%, 0 ${pct(1 - p * 2)})`,
      }
    case 'diagbr':
      return {
        clipPath: `polygon(100% 100%, ${pct(1 - p * 2)} 100%, 100% ${pct(1 - p * 2)})`,
      }

    case 'zoomin':
      return { transform: `scale(${0.6 + 0.4 * p})`, opacity: p }
    case 'pixelize':
      return { opacity: p, filter: `blur(${(q * 8).toFixed(1)}px)` }
    case 'hblur':
      return { opacity: p, filter: `blur(${(q * 12).toFixed(1)}px)` }
    case 'radial':
      return { clipPath: `circle(${pct(p * 0.75)} at 50% 50%)` }

    case 'hlslice':
    case 'hrslice':
      return { clipPath: `inset(0 ${pct(q)} 0 0)`, opacity: Math.min(1, p * 1.4) }
    case 'vuslice':
    case 'vdslice':
      return { clipPath: `inset(${pct(q)} 0 0 0)`, opacity: Math.min(1, p * 1.4) }
    case 'hlwind':
    case 'hrwind':
      return { opacity: p, transform: `translateX(${pct(q * 0.2)})` }

    default:
      // generic crossfade fallback for effects with no cheap CSS equivalent
      return { opacity: p }
  }
}

/** Effects previewed exactly vs approximated (for UI labeling). */
export function isApproximateEffect(effect: string): boolean {
  return [
    'distance',
    'circlecrop',
    'rectcrop',
    'pixelize',
    'radial',
    'hblur',
    'hlslice',
    'hrslice',
    'vuslice',
    'vdslice',
    'hlwind',
    'hrwind',
    'dissolve',
  ].includes(effect)
}

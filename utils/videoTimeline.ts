/** Browser media seeks use microsecond timestamps. Truncating a fractional
 * frame boundary (14/30 -> .466666) selects the preceding decoded frame.
 * Round upward by less than one microsecond, never by a whole frame. */
export function videoSeekTime(time: number): number {
  return Math.ceil(Math.max(0, time) * 1_000_000) / 1_000_000
}

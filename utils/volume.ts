/** Percent controls keep the renderer's gain values and template bindings intact. */
export function volumePercent(value: number | string | undefined) {
  return typeof value === 'number' ? Math.round(value * 10000) / 100 : value
}

export function volumeGain(value: number | string | undefined) {
  return typeof value === 'number'
    ? Math.round(Math.max(0, Math.min(200, value)) * 10) / 1000
    : value
}

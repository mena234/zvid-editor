import { reactive } from 'vue'

/**
 * Editor-only runtime cache of measured dimensions for auto-sized items
 * (TEXT / SVG without explicit width/height — the package measures those via
 * Puppeteer at render time). Keyed by item _id.
 */
const measured = reactive(new Map<string, { width: number; height: number }>())

export function useMeasuredDims() {
  function setMeasured(id: string, width: number, height: number) {
    const cur = measured.get(id)
    if (cur && Math.abs(cur.width - width) < 0.5 && Math.abs(cur.height - height) < 0.5)
      return
    measured.set(id, { width, height })
  }
  function getMeasured(id: string) {
    return measured.get(id) ?? null
  }
  function dropMeasured(id: string) {
    measured.delete(id)
  }
  return { measured, setMeasured, getMeasured, dropMeasured }
}

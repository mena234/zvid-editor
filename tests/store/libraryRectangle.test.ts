import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useProjectStore } from '../../stores/project'
import { LIBRARY_RECTANGLE } from '../helpers/libraryRectangle'

const rectangle = () => ({
  type: 'SVG', svg: LIBRARY_RECTANGLE, width: 188, height: 180,
  x: 20, y: 149, track: 0,
})

describe('library rectangle bounds', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => vi.unstubAllGlobals())

  it('corrects new rectangles in the same undoable add, retaining authored geometry', () => {
    const store = useProjectStore()
    store.resetHistory()
    const added = store.addVisual('root', rectangle())
    const exported = store.exportRaw().visuals[0]
    expect(exported).toMatchObject({ type: 'SVG', x: 20, y: 149, width: 188, height: 180, svg: expect.stringContaining('viewBox="8 8 384 244"') })
    store.undo()
    expect(store.doc.visuals).toHaveLength(0)
    store.redo()
    expect(store.visualById(added._id)?.svg).toBe(exported.svg)
  })

  it('corrects existing root and scene rectangles on import and retains the corrected resize baseline', () => {
    const store = useProjectStore()
    store.loadRaw({
      duration: 10, visuals: [rectangle()],
      scenes: [{ duration: 10, visuals: [rectangle()] }],
    })
    const exported = store.exportRaw()
    expect(exported.visuals[0].svg).toContain('viewBox="8 8 384 244"')
    expect(exported.scenes[0].visuals[0].svg).toBe(exported.visuals[0].svg)
    const item = store.doc.visuals[0]
    store.patchVisual(item._id, { width: 400 })
    store.undo()
    expect(store.doc.visuals[0].width).toBe(188)
    expect(store.doc.visuals[0].svg).toBe(exported.visuals[0].svg)
  })

  it('corrects an old autosave before creating its history baseline', () => {
    const store = useProjectStore()
    store.doc.visuals.push({ ...rectangle(), _id: 'vis_old' })
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(store.doc) })
    expect(store.loadAutosave()).toBe(true)
    expect(store.exportRaw().visuals[0].svg).toContain('viewBox="8 8 384 244"')
    expect(JSON.parse(store.history.stack[0]).visuals[0].svg).toBe(store.doc.visuals[0].svg)
  })

  it('preserves shapes controlled by custom code or styles', () => {
    const store = useProjectStore()
    for (const extra of [{ customCode: { css: 'rect { stroke: red; }' } }, { style: { filter: 'blur(8px)' } }]) {
      const item = store.addVisual('root', { ...rectangle(), ...extra })
      expect(item.svg).toBe(LIBRARY_RECTANGLE)
    }
  })
})

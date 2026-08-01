import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useProjectStore } from '../../stores/project'
import { useEditorStore } from '../../stores/editor'

/**
 * Image-mode layer stack (zOrderOf / applyLayerOrder / moveLayer) and the
 * replace-image arming flow on the editor store.
 */

function imageItem(src: string, extra: Record<string, any> = {}) {
  return { type: 'IMAGE', src, ...extra }
}

function makeImageStore() {
  const store = useProjectStore()
  store.doc.type = 'image'
  return store
}

describe('project store — image layer order', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('zOrderOf sorts by track then keeps array order (stable)', () => {
    const store = makeImageStore()
    const a = store.addVisual('root', imageItem('a.png'))
    const b = store.addVisual('root', imageItem('b.png'))
    const c = store.addVisual('root', imageItem('c.png'))
    // no tracks: paint order = array order
    expect(store.zOrderOf('root').map((v) => v._id)).toEqual([a._id, b._id, c._id])
    // an explicit track overrides array position
    store.patchVisual(a._id, { track: 5 })
    expect(store.zOrderOf('root').map((v) => v._id)).toEqual([b._id, c._id, a._id])
  })

  it('moveLayer swaps a layer toward the front and strips tracks', () => {
    const store = makeImageStore()
    const a = store.addVisual('root', imageItem('a.png'))
    const b = store.addVisual('root', imageItem('b.png'))
    const c = store.addVisual('root', imageItem('c.png'))
    store.moveLayer(a._id, 1)
    expect(store.doc.visuals.map((v) => v._id)).toEqual([b._id, a._id, c._id])
    store.moveLayer(c._id, -1)
    expect(store.doc.visuals.map((v) => v._id)).toEqual([b._id, c._id, a._id])
    expect(store.doc.visuals.every((v) => v.track === undefined)).toBe(true)
  })

  it('moveLayer starts from the effective z-order when tracks exist', () => {
    const store = makeImageStore()
    const a = store.addVisual('root', imageItem('a.png', { track: 2 })) // front
    const b = store.addVisual('root', imageItem('b.png')) // back (track 0)
    // z-order is [b, a]; moving b forward must land it in front of a
    store.moveLayer(b._id, 1)
    expect(store.doc.visuals.map((v) => v._id)).toEqual([a._id, b._id])
    expect(store.doc.visuals.every((v) => v.track === undefined)).toBe(true)
  })

  it('moveLayer no-ops at the stack boundaries', () => {
    const store = makeImageStore()
    const a = store.addVisual('root', imageItem('a.png'))
    const b = store.addVisual('root', imageItem('b.png'))
    store.moveLayer(b._id, 1) // already front-most
    store.moveLayer(a._id, -1) // already back-most
    expect(store.doc.visuals.map((v) => v._id)).toEqual([a._id, b._id])
  })

  it('applyLayerOrder rejects non-permutations', () => {
    const store = makeImageStore()
    const a = store.addVisual('root', imageItem('a.png'))
    const b = store.addVisual('root', imageItem('b.png'))
    store.applyLayerOrder('root', [a._id]) // wrong length
    store.applyLayerOrder('root', [a._id, a._id]) // duplicate
    store.applyLayerOrder('root', [a._id, 'vis_nope']) // unknown id
    expect(store.doc.visuals.map((v) => v._id)).toEqual([a._id, b._id])
  })

  it('layer actions are image-mode only (video keeps track semantics)', () => {
    const store = useProjectStore()
    const a = store.addVisual('root', { type: 'TEXT', text: 'a' })
    const b = store.addVisual('root', { type: 'TEXT', text: 'b', track: 1 })
    store.moveLayer(a._id, 1)
    store.applyLayerOrder('root', [b._id, a._id])
    expect(store.doc.visuals.map((v) => v._id)).toEqual([a._id, b._id])
    expect(store.doc.visuals[1].track).toBe(1)
  })

  it('reorder is undoable', () => {
    const store = makeImageStore()
    store.resetHistory()
    const a = store.addVisual('root', imageItem('a.png'))
    const b = store.addVisual('root', imageItem('b.png'))
    store.moveLayer(a._id, 1)
    expect(store.doc.visuals.map((v) => v._id)).toEqual([b._id, a._id])
    store.undo()
    expect(store.doc.visuals.map((v) => v._id)).toEqual([a._id, b._id])
  })
})

describe('editor store — replace-image mode', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('startReplaceImage opens the Images tab and arms the target', () => {
    const editor = useEditorStore()
    editor.leftPanel = null
    editor.startReplaceImage('vis_1')
    expect(editor.leftPanel).toBe('images')
    expect(editor.panelView).toBe('main')
    expect(editor.replaceTargetId).toBe('vis_1')
  })

  it('switching to any other tab disarms replace mode', () => {
    const editor = useEditorStore()
    editor.startReplaceImage('vis_1')
    editor.openPanel('text')
    expect(editor.replaceTargetId).toBeNull()

    editor.startReplaceImage('vis_1')
    editor.togglePanel('shape')
    expect(editor.replaceTargetId).toBeNull()

    // collapsing the Images tab also disarms
    editor.startReplaceImage('vis_1')
    editor.togglePanel('images')
    expect(editor.leftPanel).toBeNull()
    expect(editor.replaceTargetId).toBeNull()
  })

  it('re-opening the Images tab keeps replace mode armed', () => {
    const editor = useEditorStore()
    editor.startReplaceImage('vis_1')
    editor.openPanel('images')
    expect(editor.replaceTargetId).toBe('vis_1')
  })

  it('replacing via patchVisual keeps every other attribute', () => {
    const project = useProjectStore()
    project.doc.type = 'image'
    const v = project.addVisual('root', {
      type: 'IMAGE',
      src: 'old.png',
      width: 320,
      height: 200,
      x: 40,
      y: 60,
      radius: 12,
      opacity: 0.8,
      resize: 'cover',
    })
    project.patchVisual(v._id, { src: 'new.png' })
    const after = project.visualById(v._id) as any
    expect(after.src).toBe('new.png')
    expect(after.width).toBe(320)
    expect(after.height).toBe(200)
    expect(after.x).toBe(40)
    expect(after.y).toBe(60)
    expect(after.radius).toBe(12)
    expect(after.opacity).toBe(0.8)
    expect(after.resize).toBe('cover')
  })
})

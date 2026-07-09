import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useProjectStore } from '../../stores/project'

/**
 * Undo/redo history of the project store. HISTORY_LIMIT is 100 in
 * stores/project.ts. `autosaveSoon` no-ops without `window`, so no stubs
 * are needed here. Items pass an explicit `track` so the lane allocator
 * (which touches the editor store) stays out of the way.
 */

function textItem(extra: Record<string, any> = {}) {
  return { type: 'TEXT', text: 'hi', track: 0, ...extra }
}

describe('project store — history', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('starts with an empty history (nothing to undo or redo)', () => {
    const store = useProjectStore()
    expect(store.history.stack).toEqual([])
    expect(store.history.index).toBe(-1)
    expect(store.canUndo).toBe(false)
    expect(store.canRedo).toBe(false)
  })

  it('resetHistory seeds a single baseline snapshot of the current doc', () => {
    const store = useProjectStore()
    store.doc.duration = 42
    store.resetHistory()
    expect(store.history.stack).toHaveLength(1)
    expect(store.history.index).toBe(0)
    expect(JSON.parse(store.history.stack[0]).duration).toBe(42)
    expect(store.canUndo).toBe(false)
    expect(store.canRedo).toBe(false)
  })

  it('commit pushes a snapshot, advances the index and marks dirty', () => {
    const store = useProjectStore()
    store.resetHistory()
    expect(store.dirty).toBe(false)
    store.doc.duration = 20
    store.commit()
    expect(store.history.stack).toHaveLength(2)
    expect(store.history.index).toBe(1)
    expect(store.dirty).toBe(true)
    expect(store.canUndo).toBe(true)
    expect(store.canRedo).toBe(false)
  })

  it('dedupes identical consecutive snapshots (no push, no dirty flag)', () => {
    const store = useProjectStore()
    store.resetHistory()
    store.commit() // doc unchanged since baseline
    expect(store.history.stack).toHaveLength(1)
    expect(store.history.index).toBe(0)
    expect(store.dirty).toBe(false)

    store.doc.duration = 33
    store.commit()
    store.commit() // no change between the two
    expect(store.history.stack).toHaveLength(2)
  })

  it('undo/redo round-trips restore the doc and keep element _ids resolvable', () => {
    const store = useProjectStore()
    store.resetHistory()
    const added = store.addVisual('root', textItem()) // commit #1
    store.patchVisual(added._id, { x: 500 }) // commit #2
    expect(store.visualById(added._id)!.x).toBe(500)

    store.undo()
    // back to the just-added state — same _id, patch reverted
    const afterUndo = store.visualById(added._id)
    expect(afterUndo).toBeDefined()
    expect(afterUndo!.x).toBeUndefined()
    expect(store.canRedo).toBe(true)

    store.undo()
    // back to the empty baseline
    expect(store.doc.visuals).toHaveLength(0)
    expect(store.visualById(added._id)).toBeUndefined()
    expect(store.canUndo).toBe(false)

    store.redo()
    store.redo()
    const afterRedo = store.visualById(added._id)
    expect(afterRedo).toBeDefined()
    expect(afterRedo!.x).toBe(500)
    expect(store.canRedo).toBe(false)
  })

  it('undo at the baseline and redo at the tip are no-ops', () => {
    const store = useProjectStore()
    store.resetHistory()
    const before = store.history.index
    store.undo()
    expect(store.history.index).toBe(before)
    store.redo()
    expect(store.history.index).toBe(before)
  })

  it('a new commit after undo drops the redo tail', () => {
    const store = useProjectStore()
    store.resetHistory()
    store.doc.duration = 20
    store.commit()
    store.doc.duration = 30
    store.commit()
    expect(store.history.stack).toHaveLength(3)

    store.undo() // duration back to 20
    expect(store.doc.duration).toBe(20)
    expect(store.canRedo).toBe(true)

    store.doc.duration = 99
    store.commit()
    expect(store.canRedo).toBe(false)
    expect(store.history.stack).toHaveLength(3) // baseline, 20, 99
    expect(JSON.parse(store.history.stack[2]).duration).toBe(99)
    store.redo() // nothing to redo
    expect(store.doc.duration).toBe(99)
  })

  it('trims the stack to HISTORY_LIMIT (100), dropping the oldest snapshots', () => {
    const store = useProjectStore()
    store.resetHistory() // baseline duration 10
    for (let i = 1; i <= 120; i++) {
      store.doc.duration = 100 + i
      store.commit()
    }
    expect(store.history.stack).toHaveLength(100)
    expect(store.history.index).toBe(99)
    expect(store.canRedo).toBe(false)

    // 121 snapshots were produced (baseline + 120); only the last 100
    // survive, so walking all the way back lands on commit #21
    let undos = 0
    while (store.canUndo) {
      store.undo()
      undos++
    }
    expect(undos).toBe(99)
    expect(store.doc.duration).toBe(121)
  })

  it('resetHistory collapses everything to the current doc', () => {
    const store = useProjectStore()
    store.resetHistory()
    store.doc.duration = 20
    store.commit()
    store.doc.duration = 30
    store.commit()
    store.undo()

    store.resetHistory()
    expect(store.history.stack).toHaveLength(1)
    expect(store.history.index).toBe(0)
    expect(JSON.parse(store.history.stack[0]).duration).toBe(20)
    expect(store.canUndo).toBe(false)
    expect(store.canRedo).toBe(false)
  })

  it('mutating actions commit on their own (addVisual/removeVisual undo cleanly)', () => {
    const store = useProjectStore()
    store.resetHistory()
    const a = store.addVisual('root', textItem())
    const b = store.addVisual('root', textItem({ text: 'second' }))
    store.removeVisual(a._id)
    expect(store.doc.visuals.map((v) => v._id)).toEqual([b._id])

    store.undo() // un-remove
    expect(store.doc.visuals.map((v) => v._id)).toEqual([a._id, b._id])
    store.undo() // un-add b
    expect(store.doc.visuals.map((v) => v._id)).toEqual([a._id])
    store.redo()
    store.redo()
    expect(store.doc.visuals.map((v) => v._id)).toEqual([b._id])
  })
})

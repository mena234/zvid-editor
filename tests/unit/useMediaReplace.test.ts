import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useProjectStore } from '../../stores/project'
import { useEditorStore } from '../../stores/editor'
import { useMediaReplace } from '../../composables/useMediaReplace'

// editor.notify touches window (toast timer) — the node env has none
;(globalThis as any).window = globalThis

function armImageProject() {
  const project = useProjectStore()
  project.doc.type = 'image'
  const target = project.addVisual('root', {
    type: 'IMAGE',
    src: 'old.png',
    width: 400,
    height: 300,
    x: 10,
    y: 20,
  })
  const editor = useEditorStore()
  editor.startReplaceImage(target._id)
  return { project, editor, target }
}

describe('useMediaReplace — tryReplace', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useRealTimers()
  })

  it('armed: swaps src in place, keeps attributes, disarms', () => {
    const { project, editor, target } = armImageProject()
    const { tryReplace } = useMediaReplace()
    expect(tryReplace('image', 'new.png')).toBe(true)
    const after = project.visualById(target._id) as any
    expect(after.src).toBe('new.png')
    expect(after.width).toBe(400)
    expect(after.x).toBe(10)
    expect(project.doc.visuals).toHaveLength(1)
    expect(editor.replaceTargetId).toBeNull()
    expect(editor.selectedId).toBe(target._id)
  })

  it('accepts the stock-drag payload casing (IMAGE)', () => {
    const { project, target } = armImageProject()
    const { tryReplace } = useMediaReplace()
    expect(tryReplace('IMAGE', 'new.png')).toBe(true)
    expect((project.visualById(target._id) as any).src).toBe('new.png')
  })

  it('swallows the second click of a double-click after replacing', () => {
    const { project } = armImageProject()
    const { tryReplace } = useMediaReplace()
    expect(tryReplace('image', 'new.png')).toBe(true)
    // disarmed now — the double-click echo of the same src must be swallowed
    expect(tryReplace('image', 'new.png')).toBe(true)
    expect(project.doc.visuals).toHaveLength(1)
    // a different src afterwards is a genuine add
    expect(tryReplace('image', 'other.png')).toBe(false)
  })

  it('not armed and no recent replace: never intercepts', () => {
    setActivePinia(createPinia())
    const project = useProjectStore()
    project.doc.type = 'image'
    const { tryReplace } = useMediaReplace()
    expect(tryReplace('image', 'fresh-never-replaced.png')).toBe(false)
  })

  it('non-image kinds pass through', () => {
    const { editor } = armImageProject()
    const { tryReplace } = useMediaReplace()
    expect(tryReplace('video', 'clip.mp4')).toBe(false)
    expect(editor.replaceTargetId).not.toBeNull() // stays armed
  })

  it('deleted target: disarms and falls back to a normal add', () => {
    const { project, editor, target } = armImageProject()
    project.removeVisual(target._id)
    const { tryReplace } = useMediaReplace()
    expect(tryReplace('image', 'unique-after-delete.png')).toBe(false)
    expect(editor.replaceTargetId).toBeNull()
  })
})

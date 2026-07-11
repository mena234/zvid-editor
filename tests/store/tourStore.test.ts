import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTourStore } from '../../stores/tour'
import { useEditorStore } from '../../stores/editor'
import { useProjectStore } from '../../stores/project'

/**
 * stores/tour.ts — step sequencing, image-mode filtering, the panel/timeline
 * side-effects, and the auto-start guards (seen flag, test hooks, deep links).
 * localStorage/window are stubbed per test (vitest runs in node).
 */

let storage: Record<string, string>

beforeEach(() => {
  setActivePinia(createPinia())
  storage = {}
  ;(globalThis as any).localStorage = {
    getItem: (k: string) => storage[k] ?? null,
    setItem: (k: string, v: string) => {
      storage[k] = v
    },
    removeItem: (k: string) => {
      delete storage[k]
    },
  }
  ;(globalThis as any).window = { location: { search: '' } }
})

afterEach(() => {
  delete (globalThis as any).localStorage
  delete (globalThis as any).window
})

describe('steps', () => {
  it('video projects see every step, in welcome→…→done order', () => {
    const tour = useTourStore()
    const ids = tour.steps.map((s) => s.id)
    expect(ids[0]).toBe('welcome')
    expect(ids[ids.length - 1]).toBe('done')
    expect(ids).toContain('timeline')
  })

  it('image mode drops the timeline step', () => {
    const project = useProjectStore()
    project.doc.type = 'image'
    const tour = useTourStore()
    expect(tour.steps.some((s) => s.id === 'timeline')).toBe(false)
    expect(tour.steps.some((s) => s.id === 'stage')).toBe(true)
  })
})

describe('sequencing', () => {
  it('start opens at step 0 and closes any modal', () => {
    const tour = useTourStore()
    const editor = useEditorStore()
    editor.openModal('export')
    tour.start()
    expect(tour.active).toBe(true)
    expect(tour.stepIndex).toBe(0)
    expect(editor.modal).toBe(null)
    expect(tour.current?.id).toBe('welcome')
  })

  it('next/prev walk the steps; prev clamps at 0', () => {
    const tour = useTourStore()
    tour.start()
    tour.prev()
    expect(tour.stepIndex).toBe(0)
    tour.next()
    expect(tour.current?.id).toBe('rail')
    tour.prev()
    expect(tour.current?.id).toBe('welcome')
  })

  it('next on the last step finishes and marks the tour seen', () => {
    const tour = useTourStore()
    tour.start()
    for (let i = 0; i < tour.steps.length - 1; i++) tour.next()
    expect(tour.isLast).toBe(true)
    expect(tour.active).toBe(true)
    tour.next()
    expect(tour.active).toBe(false)
    expect(storage['zvid-tour-seen']).toBe('1')
  })

  it('finish (skip) also marks seen', () => {
    const tour = useTourStore()
    tour.start()
    tour.finish()
    expect(tour.active).toBe(false)
    expect(tour.hasSeen()).toBe(true)
  })

  it('current is null when inactive', () => {
    const tour = useTourStore()
    expect(tour.current).toBe(null)
  })
})

describe('step side-effects', () => {
  it('rail/panel steps open the images library when the panel is collapsed or inspecting', () => {
    const tour = useTourStore()
    const editor = useEditorStore()
    editor.leftPanel = null
    tour.start()
    tour.next() // rail
    expect(editor.leftPanel).toBe('images')
    expect(editor.panelView).toBe('main')

    editor.leftPanel = 'text'
    editor.panelView = 'inspector'
    tour.next() // panel
    expect(editor.panelView).toBe('main')
  })

  it('rail step leaves an already-open library tab alone', () => {
    const tour = useTourStore()
    const editor = useEditorStore()
    editor.openPanel('videos')
    tour.start()
    tour.next() // rail
    expect(editor.leftPanel).toBe('videos')
  })

  it('timeline step expands a collapsed timeline', () => {
    const tour = useTourStore()
    const editor = useEditorStore()
    editor.timelineCollapsed = true
    tour.start()
    while (tour.current?.id !== 'timeline') tour.next()
    expect(editor.timelineCollapsed).toBe(false)
  })
})

describe('maybeAutoStart', () => {
  it('starts on a clean first visit', () => {
    const tour = useTourStore()
    tour.maybeAutoStart()
    expect(tour.active).toBe(true)
  })

  it('does not start when already seen', () => {
    storage['zvid-tour-seen'] = '1'
    const tour = useTourStore()
    tour.maybeAutoStart()
    expect(tour.active).toBe(false)
  })

  it('does not start under the E2E bridge (zvid-test-hooks)', () => {
    storage['zvid-test-hooks'] = '1'
    const tour = useTourStore()
    tour.maybeAutoStart()
    expect(tour.active).toBe(false)
  })

  it('does not start on deep links, and keeps the first-run flag unburned', () => {
    for (const q of ['?project=p1', '?template=t1', '?example=slug']) {
      ;(globalThis as any).window.location.search = q
      const tour = useTourStore()
      tour.maybeAutoStart()
      expect(tour.active).toBe(false)
    }
    expect(storage['zvid-tour-seen']).toBeUndefined()
    // next plain visit still gets the tour
    ;(globalThis as any).window.location.search = ''
    const tour = useTourStore()
    tour.maybeAutoStart()
    expect(tour.active).toBe(true)
  })

  it('is a no-op while already active', () => {
    const tour = useTourStore()
    tour.start()
    tour.next()
    tour.maybeAutoStart()
    expect(tour.stepIndex).toBe(1)
  })
})

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useEditorStore } from '../../stores/editor'

/**
 * stores/editor.ts — selection, zoom/seek clamps, context switches, toast
 * timer and theme setter. Browser APIs are stubbed minimally on globalThis
 * (no jsdom): `window` aliases globalThis so the store's window timers hit
 * vitest's fake timers; document/localStorage are tiny hand-rolled fakes.
 */

function fakeStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    _map: map,
  }
}

function fakeDocument(initialTheme: string | null = null) {
  const attrs = new Map<string, string>()
  if (initialTheme) attrs.set('data-theme', initialTheme)
  return {
    documentElement: {
      getAttribute: (k: string) => attrs.get(k) ?? null,
      setAttribute: (k: string, v: string) => void attrs.set(k, v),
      _attrs: attrs,
    },
  }
}

describe('editor store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('window', globalThis)
    vi.stubGlobal('localStorage', fakeStorage())
    vi.stubGlobal('document', fakeDocument())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  describe('selection', () => {
    it('selectVisual replaces the selection by default', () => {
      const s = useEditorStore()
      s.selectVisual('a')
      expect(s.selectionKind).toBe('visual')
      expect(s.selectedId).toBe('a')
      expect(s.selectedIds).toEqual(['a'])
      s.selectVisual('b')
      expect(s.selectedId).toBe('b')
      expect(s.selectedIds).toEqual(['b'])
      expect(s.hasSelection).toBe(true)
    })

    it('additive select accumulates and keeps the last-added as primary', () => {
      const s = useEditorStore()
      s.selectVisual('a')
      s.selectVisual('b', true)
      expect(s.selectedIds).toEqual(['a', 'b'])
      expect(s.selectedId).toBe('b')
      s.selectVisual('c', true)
      expect(s.selectedIds).toEqual(['a', 'b', 'c'])
      expect(s.selectedId).toBe('c')
    })

    it('additive select toggles an already-selected id off', () => {
      const s = useEditorStore()
      s.selectVisual('a')
      s.selectVisual('b', true)
      s.selectVisual('b', true) // toggle b back off
      expect(s.selectedIds).toEqual(['a'])
      expect(s.selectedId).toBe('a')
      expect(s.selectionKind).toBe('visual')
    })

    it('toggling the last selected id off clears the selection entirely', () => {
      const s = useEditorStore()
      s.selectVisual('a')
      s.selectVisual('a', true)
      expect(s.selectedIds).toEqual([])
      expect(s.selectedId).toBeNull()
      expect(s.selectionKind).toBeNull()
      expect(s.hasSelection).toBe(false)
    })

    it('additive on an empty selection behaves like a single select', () => {
      const s = useEditorStore()
      s.selectVisual('a', true) // no prior selectedId → non-additive branch
      expect(s.selectedIds).toEqual(['a'])
      expect(s.selectedId).toBe('a')
    })

    it('audio/caption/scene selection resets the multi-select list', () => {
      const s = useEditorStore()
      s.selectVisual('a')
      s.selectVisual('b', true)
      s.selectAudio('aud1')
      expect(s.selectionKind).toBe('audio')
      expect(s.selectedId).toBe('aud1')
      expect(s.selectedIds).toEqual([])

      s.selectCaption(4)
      expect(s.selectionKind).toBe('caption')
      expect(s.selectedId).toBe('4')
      expect(s.selectedCaptionIndex).toBe(4)

      s.selectScene('scn_1')
      expect(s.selectionKind).toBe('scene')
      expect(s.selectedId).toBe('scn_1')

      s.clearSelection()
      expect(s.selectionKind).toBeNull()
      expect(s.selectedId).toBeNull()
      expect(s.selectedCaptionIndex).toBe(-1)
    })

    it('setContext clears the selection and resets playback', () => {
      const s = useEditorStore()
      s.selectVisual('a')
      s.playhead = 3.5
      s.playing = true
      s.setContext('scn_1')
      expect(s.context).toBe('scn_1')
      expect(s.selectionKind).toBeNull()
      expect(s.selectedId).toBeNull()
      expect(s.selectedIds).toEqual([])
      expect(s.playhead).toBe(0)
      expect(s.playing).toBe(false)
    })
  })

  describe('playback + view', () => {
    it('seek clamps to [0, duration]', () => {
      const s = useEditorStore()
      s.seek(-5, 10)
      expect(s.playhead).toBe(0)
      s.seek(50, 10)
      expect(s.playhead).toBe(10)
      s.seek(3.25, 10)
      expect(s.playhead).toBe(3.25)
      s.seek(1e9) // default max = Infinity
      expect(s.playhead).toBe(1e9)
    })

    it('setZoom clamps px-per-second to 8–600', () => {
      const s = useEditorStore()
      s.setZoom(1)
      expect(s.pxPerSec).toBe(8)
      s.setZoom(10_000)
      expect(s.pxPerSec).toBe(600)
      s.setZoom(120)
      expect(s.pxPerSec).toBe(120)
    })

    it('togglePlay flips playing', () => {
      const s = useEditorStore()
      expect(s.playing).toBe(false)
      s.togglePlay()
      expect(s.playing).toBe(true)
      s.togglePlay()
      expect(s.playing).toBe(false)
    })

    it('scenePreviewMode defaults to overlay editing and is switchable', () => {
      const s = useEditorStore()
      expect(s.scenePreviewMode).toBe('scene')
      s.scenePreviewMode = 'full'
      expect(s.scenePreviewMode).toBe('full')
      s.scenePreviewMode = 'scene'
      expect(s.scenePreviewMode).toBe('scene')
    })
  })

  describe('toast', () => {
    it('notify shows a toast that auto-clears after 3.5s', () => {
      vi.useFakeTimers()
      const s = useEditorStore()
      s.notify('saved', 'success')
      expect(s.toast).toEqual({ message: 'saved', kind: 'success' })
      vi.advanceTimersByTime(3499)
      expect(s.toast).not.toBeNull()
      vi.advanceTimersByTime(1)
      expect(s.toast).toBeNull()
    })

    it('a newer toast restarts the dismissal timer', () => {
      vi.useFakeTimers()
      const s = useEditorStore()
      s.notify('first')
      vi.advanceTimersByTime(2000)
      s.notify('second', 'error')
      vi.advanceTimersByTime(2000) // 4s after the first — it would have expired
      expect(s.toast).toEqual({ message: 'second', kind: 'error' })
      vi.advanceTimersByTime(1500)
      expect(s.toast).toBeNull()
    })

    it('notify defaults to the info kind', () => {
      vi.useFakeTimers()
      const s = useEditorStore()
      s.notify('hello')
      expect(s.toast!.kind).toBe('info')
    })
  })

  describe('theme', () => {
    it('setTheme updates state, the html attribute and localStorage', () => {
      const s = useEditorStore()
      s.setTheme('dark')
      expect(s.theme).toBe('dark')
      expect(
        (document as any).documentElement.getAttribute('data-theme')
      ).toBe('dark')
      expect((localStorage as any).getItem('zvid-theme')).toBe('dark')
    })

    it('toggleTheme flips between light and dark', () => {
      const s = useEditorStore()
      expect(s.theme).toBe('light')
      s.toggleTheme()
      expect(s.theme).toBe('dark')
      s.toggleTheme()
      expect(s.theme).toBe('light')
      expect((localStorage as any).getItem('zvid-theme')).toBe('light')
    })

    it('a throwing localStorage does not break setTheme', () => {
      vi.stubGlobal('localStorage', {
        setItem: () => {
          throw new Error('quota')
        },
      })
      const s = useEditorStore()
      expect(() => s.setTheme('dark')).not.toThrow()
      expect(s.theme).toBe('dark')
    })

    it('initTheme syncs from the pre-mount data-theme attribute', () => {
      vi.stubGlobal('document', fakeDocument('dark'))
      const s = useEditorStore()
      s.initTheme()
      expect(s.theme).toBe('dark')
      vi.stubGlobal('document', fakeDocument(null))
      s.initTheme() // anything but 'dark' → light
      expect(s.theme).toBe('light')
    })
  })

  describe('modals', () => {
    it('openModal/closeModal round-trip and closing clears the designer target', () => {
      const s = useEditorStore()
      s.openDesigner('vis_1')
      expect(s.modal).toBe('designer')
      expect(s.designerTargetId).toBe('vis_1')
      s.closeModal()
      expect(s.modal).toBeNull()
      expect(s.designerTargetId).toBeNull()
      s.openModal('export')
      expect(s.modal).toBe('export')
    })
  })
})

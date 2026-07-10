import { defineStore } from 'pinia'
import { useProjectStore } from '~/stores/project'
import { canonicalVisualType } from '~/shared/schema/types'

export type SelectionKind = 'visual' | 'audio' | 'caption' | 'scene' | null
/** Which face of the shared side panel is showing: the tab's library
 *  content, or the properties (inspector) of the current selection. */
export type PanelView = 'main' | 'inspector'
export type LeftPanel =
  | 'images'
  | 'videos'
  | 'audio'
  | 'gifs'
  | 'text'
  | 'design'
  | 'shape'
  | 'canvas'
  | 'subtitles'
  | 'scenes'
  | 'variables'
export type ModalKind =
  | null
  | 'export'
  | 'import'
  | 'examples'
  | 'shortcuts'
  | 'render'
  | 'projects'
  | 'designer'
  | 'auth'
  | 'saveProject'
  | 'saveTemplate'
  | 'publishExample'

/** The library example an admin opened for editing (drives the Publish flow). */
export interface SourceExample {
  slug: string
  title: string
  meta: Record<string, any> | null
}

export const useEditorStore = defineStore('editor', {
  state: () => ({
    /* selection */
    selectionKind: null as SelectionKind,
    selectedId: null as string | null,
    selectedIds: [] as string[], // multi-select (visuals only)
    selectedCaptionIndex: -1,

    /* editing context: 'root' or scene _id */
    context: 'root' as string,
    /** scenes projects at root: 'scene' edits the global overlay track over
     *  the full movie; 'full' is the read-only full-movie preview */
    scenePreviewMode: 'scene' as 'scene' | 'full',

    /* playback */
    playhead: 0,
    playing: false,
    loop: true,
    muted: false,
    playbackRate: 1,

    /* timeline view */
    pxPerSec: 60,
    timelineScroll: 0,
    snapping: true,
    extraVisualTracks: [] as number[],
    extraAudioTracks: [] as number[],

    /* stage view */
    stageZoom: 0 as number, // 0 = fit
    showSafeArea: false,
    showGrid: false,
    /** substitute {{placeholders}} with variable defaults on the stage */
    variablesPreview: true,

    /* appearance */
    theme: 'light' as 'light' | 'dark',

    /* panels — a single shared side panel (Veed-style): `leftPanel` is the
       active rail tab (null = collapsed), `panelView` flips between the
       tab's library content and the selection's properties */
    leftPanel: 'images' as LeftPanel | null,
    panelView: 'main' as PanelView,
    modal: null as ModalKind,
    /** modal to reopen after a successful sign-in (save gating) */
    postAuthModal: null as ModalKind,
    /** cloud project the current document is linked to (null = unsaved) */
    cloudProject: null as null | { id: string; name: string },
    /** library example being edited by an admin (null = not editing one) */
    sourceExample: null as null | SourceExample,
    /** visual _id being edited in the Design Studio (null = create new) */
    designerTargetId: null as string | null,
    inspectorTab: 'design',

    /* transient UI */
    toast: null as { message: string; kind: 'info' | 'error' | 'success' } | null,
    dragState: null as null | { type: string },
  }),

  getters: {
    hasSelection(state): boolean {
      return state.selectionKind !== null && !!state.selectedId
    },
  },

  actions: {
    /** Sync from the data-theme attribute the head script applied pre-mount. */
    initTheme() {
      const t = document.documentElement.getAttribute('data-theme')
      this.theme = t === 'dark' ? 'dark' : 'light'
    },
    setTheme(theme: 'light' | 'dark') {
      this.theme = theme
      document.documentElement.setAttribute('data-theme', theme)
      try {
        localStorage.setItem('zvid-theme', theme)
      } catch {}
    },
    toggleTheme() {
      this.setTheme(this.theme === 'dark' ? 'light' : 'dark')
    },

    selectVisual(id: string, additive = false) {
      this.selectionKind = 'visual'
      if (additive && this.selectedId) {
        const set = new Set(this.selectedIds.length ? this.selectedIds : [this.selectedId])
        if (set.has(id)) set.delete(id)
        else set.add(id)
        this.selectedIds = [...set]
        this.selectedId = this.selectedIds[this.selectedIds.length - 1] ?? null
        if (!this.selectedId) this.selectionKind = null
      } else {
        this.selectedId = id
        this.selectedIds = [id]
      }
    },
    selectAudio(id: string) {
      this.selectionKind = 'audio'
      this.selectedId = id
      this.selectedIds = []
    },
    selectCaption(index: number) {
      this.selectionKind = 'caption'
      this.selectedId = String(index)
      this.selectedCaptionIndex = index
      this.selectedIds = []
    },
    selectScene(editorId: string) {
      this.selectionKind = 'scene'
      this.selectedId = editorId
      this.selectedIds = []
    },
    clearSelection() {
      this.selectionKind = null
      this.selectedId = null
      this.selectedIds = []
      this.selectedCaptionIndex = -1
      // the shared panel falls back to the tab's library content
      if (this.panelView === 'inspector') this.panelView = 'main'
    },

    /* ---- shared side panel ---- */

    /** Rail tab click: same tab collapses the panel, any other opens its
     *  library content. */
    togglePanel(tab: LeftPanel) {
      if (this.leftPanel === tab) {
        this.leftPanel = null
      } else {
        this.leftPanel = tab
        this.panelView = 'main'
      }
    },

    /** Programmatic "open this tab's library content" (deep links etc.). */
    openPanel(tab: LeftPanel) {
      this.leftPanel = tab
      this.panelView = 'main'
    },

    /**
     * Show the current selection's properties in the shared panel, switching
     * to the rail tab that matches the selected element's type (clicking an
     * image on the stage/timeline opens it inside the Images tab, etc.).
     */
    openInspector() {
      if (this.selectionKind === 'caption') {
        // captions are edited in the Subtitles panel itself
        this.openPanel('subtitles')
        return
      }
      this.leftPanel = this.panelTabForSelection() ?? this.leftPanel ?? 'images'
      this.panelView = 'inspector'
    },

    /** Clicking the empty stage: project settings in the shared panel. */
    openProjectSettings() {
      this.clearSelection()
      if (this.leftPanel) this.panelView = 'inspector'
    },

    /** Back button in the properties header → the tab's library content. */
    closeInspector() {
      this.panelView = 'main'
    },

    /** The rail tab that owns the currently selected element. */
    panelTabForSelection(): LeftPanel | null {
      if (this.selectionKind === 'audio') return 'audio'
      if (this.selectionKind === 'scene') return 'scenes'
      if (this.selectionKind === 'caption') return 'subtitles'
      if (this.selectionKind !== 'visual' || !this.selectedId) return null
      const project = useProjectStore()
      const v = project.visualById(this.selectedId)
      if (!v) return null
      switch (canonicalVisualType(v.type)) {
        case 'IMAGE':
          return 'images'
        case 'VIDEO':
          return 'videos'
        case 'GIF':
          return 'gifs'
        case 'TEXT':
          return (v as any).designer ? 'design' : 'text'
        case 'SVG':
          return 'shape'
        default:
          // custom/canvas-coded elements
          return 'canvas'
      }
    },

    setContext(ctx: string) {
      this.context = ctx
      this.clearSelection()
      this.playhead = 0
      this.playing = false
    },

    seek(t: number, max = Infinity) {
      this.playhead = Math.min(Math.max(0, t), max)
    },
    togglePlay() {
      this.playing = !this.playing
    },

    setZoom(pxPerSec: number) {
      this.pxPerSec = Math.min(600, Math.max(8, pxPerSec))
    },

    notify(message: string, kind: 'info' | 'error' | 'success' = 'info') {
      this.toast = { message, kind }
      const w = window as any
      clearTimeout(w.__zvidToastTimer)
      w.__zvidToastTimer = setTimeout(() => (this.toast = null), 3500)
    },

    openModal(kind: ModalKind) {
      this.modal = kind
    },
    closeModal() {
      this.modal = null
      this.designerTargetId = null
    },
    /** Open the Design Studio — targetId edits an existing visual, null creates. */
    openDesigner(targetId: string | null = null) {
      this.designerTargetId = targetId
      this.modal = 'designer'
    },

    setCloudProject(link: null | { id: string; name: string }) {
      this.cloudProject = link
    },

    setSourceExample(ex: null | SourceExample) {
      this.sourceExample = ex
    },
  },
})

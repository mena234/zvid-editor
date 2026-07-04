import { defineStore } from 'pinia'

export type SelectionKind = 'visual' | 'audio' | 'caption' | 'scene' | null
export type LeftPanel = 'add' | 'assets' | 'subtitles' | 'scenes' | 'variables'
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

export const useEditorStore = defineStore('editor', {
  state: () => ({
    /* selection */
    selectionKind: null as SelectionKind,
    selectedId: null as string | null,
    selectedIds: [] as string[], // multi-select (visuals only)
    selectedCaptionIndex: -1,

    /* editing context: 'root' or scene _id */
    context: 'root' as string,
    /** scenes projects: preview the whole movie vs the active scene */
    scenePreviewMode: 'full' as 'scene' | 'full',

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

    /* panels */
    leftPanel: 'add' as LeftPanel,
    modal: null as ModalKind,
    /** modal to reopen after a successful sign-in (save gating) */
    postAuthModal: null as ModalKind,
    /** cloud project the current document is linked to (null = unsaved) */
    cloudProject: null as null | { id: string; name: string },
    /** visual _id being edited in the Design Studio (null = create new) */
    designerTargetId: null as string | null,
    inspectorTab: 'design',

    /* transient UI */
    toast: null as { message: string; kind: 'info' | 'error' | 'success' } | null,
    dragState: null as null | { type: string },
    renderJob: null as null | {
      id: string
      status: 'running' | 'done' | 'error'
      progress: number
      error?: string
      fileUrl?: string
      fileName?: string
    },
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
  },
})

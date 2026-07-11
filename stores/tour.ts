import { defineStore } from 'pinia'
import { useEditorStore } from '~/stores/editor'
import { useProjectStore } from '~/stores/project'

/** Where the step card sits relative to the spotlit element. */
export type TourPlacement = 'right' | 'left' | 'top' | 'bottom' | 'over' | 'center'

export interface TourStep {
  id: string
  /** data-tour attribute of the element to spotlight (null = centered card) */
  target: string | null
  title: string
  body: string
  placement: TourPlacement
  /** step only makes sense for video projects (dropped in image mode) */
  videoOnly?: boolean
}

const SEEN_KEY = 'zvid-tour-seen'

const STEPS: TourStep[] = [
  {
    id: 'welcome',
    target: null,
    placement: 'center',
    title: 'Welcome to Zvid Editor',
    body: 'Design videos and images visually, then render them in the Zvid cloud or export the project as JSON for the API. This quick tour shows you around — it takes about a minute.',
  },
  {
    id: 'rail',
    target: 'rail-tabs',
    placement: 'right',
    title: 'Add content',
    body: 'Everything starts here: images, videos, audio, GIFs, text, ready-made designs, shapes and code canvases. Click a tab to open its library.',
  },
  {
    id: 'panel',
    target: 'rail-panel',
    placement: 'right',
    title: 'Library & stock',
    body: 'Each tab combines your uploads, a URL box and free stock search. Click an item to add it, or drag it straight onto the canvas. When you select an element, its properties open in this same panel.',
  },
  {
    id: 'stage',
    target: 'stage',
    placement: 'over',
    title: 'The canvas',
    body: 'A live preview of exactly what will render. Drag to move, pull the handles to resize, and double-click text to edit it. Click empty space to open the project settings.',
  },
  {
    id: 'timeline',
    target: 'timeline',
    placement: 'top',
    videoOnly: true,
    title: 'The timeline',
    body: 'Arrange clips over time: drag to reposition, pull the edges to trim, and press S to split at the playhead. Press Space to play, and ? for all shortcuts.',
  },
  {
    id: 'settings',
    target: 'project-settings',
    placement: 'bottom',
    title: 'Project settings',
    body: 'Resolution, duration, frame rate, background color and output format live up here, next to the project name.',
  },
  {
    id: 'examples',
    target: 'examples',
    placement: 'bottom',
    title: 'Start from an example',
    body: 'Not starting from scratch? Browse hundreds of ready-made templates across 20+ categories and make them yours.',
  },
  {
    id: 'output',
    target: 'output',
    placement: 'bottom',
    title: 'Save, render, export',
    body: 'Save keeps the project in your Zvid account, Render produces the final file in the cloud, and Export gives you the zvid JSON to use with the API.',
  },
  {
    id: 'done',
    target: null,
    placement: 'center',
    title: 'You’re all set',
    body: 'That’s the essentials. Replay this tour any time from the compass button in the top bar — now go make something.',
  },
]

export const useTourStore = defineStore('tour', {
  state: () => ({
    active: false,
    stepIndex: 0,
  }),

  getters: {
    steps(): TourStep[] {
      const project = useProjectStore()
      return project.isImage ? STEPS.filter((s) => !s.videoOnly) : STEPS
    },
    current(state): TourStep | null {
      return state.active ? (this.steps[state.stepIndex] ?? null) : null
    },
    isLast(state): boolean {
      return state.stepIndex >= this.steps.length - 1
    },
  },

  actions: {
    start() {
      const editor = useEditorStore()
      editor.closeModal()
      this.stepIndex = 0
      this.active = true
      this.applyStepEffects()
    },

    next() {
      if (!this.active) return
      if (this.isLast) return this.finish()
      this.stepIndex++
      this.applyStepEffects()
    },

    prev() {
      if (!this.active || this.stepIndex === 0) return
      this.stepIndex--
      this.applyStepEffects()
    },

    /** Completed or skipped — either way, never auto-open again. */
    finish() {
      this.active = false
      this.markSeen()
    },

    markSeen() {
      try {
        localStorage.setItem(SEEN_KEY, '1')
      } catch {}
    },

    hasSeen(): boolean {
      try {
        return localStorage.getItem(SEEN_KEY) === '1'
      } catch {
        return false
      }
    },

    /**
     * First-visit auto-open. Stays quiet for returning users, E2E runs
     * (zvid-test-hooks) and deep links (?project/?template/?example), where a
     * walkthrough would sit on top of the thing the user came to see.
     */
    maybeAutoStart() {
      if (this.active || this.hasSeen()) return
      try {
        if (localStorage.getItem('zvid-test-hooks')) return
      } catch {}
      const params = new URLSearchParams(window.location.search)
      if (params.get('project') || params.get('template') || params.get('example')) {
        // they already know their way in — don't interrupt, don't burn the flag
        return
      }
      this.start()
    },

    /**
     * Make the current step's target visible before the overlay measures it:
     * the rail steps need the library panel open, the timeline step needs the
     * timeline expanded.
     */
    applyStepEffects() {
      const step = this.current
      if (!step) return
      const editor = useEditorStore()
      if (step.id === 'rail' || step.id === 'panel') {
        if (!editor.leftPanel || editor.panelView !== 'main') editor.openPanel('images')
      } else if (step.id === 'timeline') {
        editor.timelineCollapsed = false
      }
    },
  },
})

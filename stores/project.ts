import { defineStore } from 'pinia'
import type {
  ProjectDoc,
  VisualDoc,
  AudioDoc,
  SceneDoc,
  RawSubtitle,
} from '~/shared/schema/types'
import { canonicalVisualType } from '~/shared/schema/types'
import {
  importProject,
  exportProject,
  exportProjectString,
  newProjectDoc,
  makeId,
} from '~/shared/schema/normalize'
import { resolveProjectDefaults, resolveVisualTiming } from '~/shared/schema/defaults'
import { resolveDocPreview, hasTemplateMarkers } from '~/shared/template/engine'
import { useEditorStore } from '~/stores/editor'

const STORAGE_KEY = 'zvid-editor:autosave'
const HISTORY_LIMIT = 100

/** Time-domain item fields never allowed in image projects (plan D2). */
const IMAGE_STRIPPED_ITEM_FIELDS = [
  'enterBegin',
  'enterEnd',
  'exitBegin',
  'exitEnd',
  'enterAnimation',
  'exitAnimation',
  'transition',
  'transitionId',
  'transitionDuration',
  'videoBegin',
  'videoEnd',
  'videoDuration',
  'volume',
  'speed',
] as const

interface HistoryState {
  stack: string[]
  index: number
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v))
}

export const useProjectStore = defineStore('project', {
  state: () => ({
    doc: newProjectDoc() as ProjectDoc,
    history: { stack: [], index: -1 } as HistoryState,
    dirty: false,
    lastSavedAt: 0,
    importWarnings: [] as string[],
  }),

  getters: {
    defaults(state) {
      return resolveProjectDefaults(state.doc)
    },
    /** Still-image project (D6): timeline/audio/subtitle UI collapses away. */
    isImage(state): boolean {
      return state.doc.type === 'image'
    },
    hasScenes(state): boolean {
      return !!state.doc.scenes?.length
    },
    canUndo(state): boolean {
      return state.history.index > 0
    },
    canRedo(state): boolean {
      return state.history.index < state.history.stack.length - 1
    },
    /** All visuals of the current editing context (root or a scene). */
    visualById(state) {
      return (id: string): VisualDoc | undefined => {
        const inRoot = state.doc.visuals.find((v) => v._id === id)
        if (inRoot) return inRoot
        for (const s of state.doc.scenes ?? []) {
          const hit = s.visuals.find((v) => v._id === id)
          if (hit) return hit
        }
        return undefined
      }
    },
    audioById(state) {
      return (id: string): AudioDoc | undefined => {
        const inRoot = state.doc.audios.find((a) => a._id === id)
        if (inRoot) return inRoot
        for (const s of state.doc.scenes ?? []) {
          const hit = s.audios.find((a) => a._id === id)
          if (hit) return hit
        }
        return undefined
      }
    },
    sceneByEditorId(state) {
      return (id: string): SceneDoc | undefined =>
        state.doc.scenes?.find((s) => s._id === id)
    },
    /** Template variable defaults (live in the export-passthrough `extra`). */
    variables(state): Record<string, unknown> {
      const v = state.doc.extra?.variables
      return v && typeof v === 'object' && !Array.isArray(v)
        ? (v as Record<string, unknown>)
        : {}
    },
    /**
     * WYSIWYG preview document: iterate expanded, condition-falsy content
     * pruned, placeholders substituted — what orch renders with the current
     * defaults. Identical to `doc` when the preview toggle is off or the
     * project uses no template features. Display-only; never persisted.
     */
    resolvedPreviewDoc(state): ProjectDoc {
      const editor = useEditorStore()
      if (!editor.variablesPreview) return state.doc
      const vars = this.variables
      if (!Object.keys(vars).length && !hasTemplateMarkers(state.doc)) {
        return state.doc
      }
      return resolveDocPreview(state.doc, vars)
    },
  },

  actions: {
    /* ---------------- history ---------------- */
    commit() {
      const snapshot = JSON.stringify(this.doc)
      const h = this.history
      if (h.stack[h.index] === snapshot) return
      h.stack = h.stack.slice(0, h.index + 1)
      h.stack.push(snapshot)
      if (h.stack.length > HISTORY_LIMIT) h.stack.shift()
      h.index = h.stack.length - 1
      this.dirty = true
      this.autosaveSoon()
    },
    undo() {
      if (!this.canUndo) return
      this.history.index -= 1
      this.doc = JSON.parse(this.history.stack[this.history.index])
      this.dirty = true
      this.autosaveSoon()
    },
    redo() {
      if (!this.canRedo) return
      this.history.index += 1
      this.doc = JSON.parse(this.history.stack[this.history.index])
      this.dirty = true
      this.autosaveSoon()
    },
    resetHistory() {
      this.history = { stack: [JSON.stringify(this.doc)], index: 0 }
    },

    /* ---------------- persistence ---------------- */
    autosaveSoon() {
      if (typeof window === 'undefined') return
      const w = window as any
      clearTimeout(w.__zvidAutosaveTimer)
      w.__zvidAutosaveTimer = setTimeout(() => this.autosaveNow(), 600)
    },
    autosaveNow() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.doc))
        this.lastSavedAt = Date.now()
      } catch {
        /* storage full/blocked — non-fatal */
      }
    },
    loadAutosave(): boolean {
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return false
        this.doc = JSON.parse(raw)
        this.resetHistory()
        return true
      } catch {
        return false
      }
    },

    /* ---------------- project lifecycle ---------------- */
    newProject(type: 'video' | 'image' = 'video') {
      this.doc = newProjectDoc(type)
      this.importWarnings = []
      this.resetHistory()
      this.autosaveNow()
    },
    loadRaw(raw: unknown) {
      const { doc, warnings } = importProject(raw)
      this.doc = doc
      this.importWarnings = warnings
      this.resetHistory()
      this.autosaveNow()
    },
    exportRaw(): Record<string, any> {
      return exportProject(this.doc)
    },
    exportString(): string {
      return exportProjectString(this.doc)
    },

    /* ---------------- project settings ---------------- */
    patchProject(patch: Partial<ProjectDoc>) {
      Object.assign(this.doc, patch)
      this.commit()
    },

    /* ---------------- template variables ---------------- */
    setVariable(name: string, value: unknown) {
      const extra = (this.doc.extra ??= {})
      const vars =
        extra.variables &&
        typeof extra.variables === 'object' &&
        !Array.isArray(extra.variables)
          ? (extra.variables as Record<string, unknown>)
          : (extra.variables = {})
      vars[name] = value
      this.commit()
    },
    renameVariable(oldName: string, newName: string) {
      const vars = this.doc.extra?.variables as Record<string, unknown> | undefined
      if (!vars || !(oldName in vars) || oldName === newName || newName in vars) return
      // rebuild to keep declaration order (orch declares variables in order)
      const next: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(vars)) next[k === oldName ? newName : k] = v
      this.doc.extra!.variables = next
      this.commit()
    },
    removeVariable(name: string) {
      const vars = this.doc.extra?.variables as Record<string, unknown> | undefined
      if (!vars || !(name in vars)) return
      delete vars[name]
      if (!Object.keys(vars).length) {
        delete this.doc.extra!.variables
        if (!Object.keys(this.doc.extra!).length) delete this.doc.extra
      }
      this.commit()
    },

    /* ---------------- collections (context-aware) ---------------- */
    /** context: 'root' or a scene _id */
    visualsOf(context: string): VisualDoc[] {
      if (context === 'root') return this.doc.visuals
      return this.sceneByEditorId(context)?.visuals ?? []
    },
    audiosOf(context: string): AudioDoc[] {
      if (context === 'root') return this.doc.audios
      return this.sceneByEditorId(context)?.audios ?? []
    },

    addVisual(context: string, item: Record<string, any>): VisualDoc {
      const doc: VisualDoc = { ...item, _id: makeId('vis') } as VisualDoc
      if (this.isImage) {
        // image projects: everything is "always on" — timing/transition
        // fields are rejected by orch/package, so never let them in
        for (const k of IMAGE_STRIPPED_ITEM_FIELDS) delete (doc as any)[k]
      }
      this.visualsOf(context).push(doc)
      this.commit()
      return doc
    },
    addAudio(context: string, item: Record<string, any>): AudioDoc {
      const doc: AudioDoc = { ...item, _id: makeId('aud') } as AudioDoc
      // image projects have no audio — the panels are hidden, this is the
      // backstop (returned doc is simply not attached to the document)
      if (this.isImage) return doc
      this.audiosOf(context).push(doc)
      this.commit()
      return doc
    },

    patchVisual(id: string, patch: Record<string, any>, commit = true) {
      const v = this.visualById(id)
      if (!v) return
      for (const [k, val] of Object.entries(patch)) {
        if (val === undefined) delete (v as any)[k]
        else (v as any)[k] = val
      }
      if (commit) this.commit()
    },
    patchAudio(id: string, patch: Record<string, any>, commit = true) {
      const a = this.audioById(id)
      if (!a) return
      for (const [k, val] of Object.entries(patch)) {
        if (val === undefined) delete (a as any)[k]
        else (a as any)[k] = val
      }
      if (commit) this.commit()
    },
    /** Replace a visual's raw content wholesale (raw JSON tab). */
    replaceVisual(id: string, next: Record<string, any>) {
      const replaceIn = (arr: VisualDoc[]) => {
        const i = arr.findIndex((v) => v._id === id)
        if (i >= 0) {
          arr[i] = { ...clone(next), _id: id } as VisualDoc
          return true
        }
        return false
      }
      if (!replaceIn(this.doc.visuals)) {
        for (const s of this.doc.scenes ?? []) if (replaceIn(s.visuals)) break
      }
      this.commit()
    },

    removeVisual(id: string) {
      const rm = (arr: VisualDoc[]) => {
        const i = arr.findIndex((v) => v._id === id)
        if (i >= 0) arr.splice(i, 1)
        return i >= 0
      }
      if (!rm(this.doc.visuals)) {
        for (const s of this.doc.scenes ?? []) if (rm(s.visuals)) break
      }
      this.commit()
    },
    removeAudio(id: string) {
      const rm = (arr: AudioDoc[]) => {
        const i = arr.findIndex((a) => a._id === id)
        if (i >= 0) arr.splice(i, 1)
        return i >= 0
      }
      if (!rm(this.doc.audios)) {
        for (const s of this.doc.scenes ?? []) if (rm(s.audios)) break
      }
      this.commit()
    },

    duplicateVisual(id: string): VisualDoc | undefined {
      const find = (arr: VisualDoc[]) => arr.find((v) => v._id === id)
      let src = find(this.doc.visuals)
      let arr: VisualDoc[] = this.doc.visuals
      if (!src) {
        for (const s of this.doc.scenes ?? []) {
          const hit = find(s.visuals)
          if (hit) {
            src = hit
            arr = s.visuals
            break
          }
        }
      }
      if (!src) return
      const copy = { ...clone(src), _id: makeId('vis') } as VisualDoc
      if (copy.id) copy.id = `${copy.id}-copy`
      // offset slightly so the duplicate is visible
      copy.x = (copy.x ?? 0) + 24
      copy.y = (copy.y ?? 0) + 24
      if (copy.position && copy.position !== 'custom') {
        copy.anchor = copy.anchor ?? (copy.position as any)
        copy.position = 'custom'
      }
      arr.push(copy)
      this.commit()
      return copy
    },
    duplicateAudio(id: string): AudioDoc | undefined {
      const src = this.audioById(id)
      if (!src) return
      const copy = { ...clone(src), _id: makeId('aud') } as AudioDoc
      const arr = this.doc.audios.includes(src as any)
        ? this.doc.audios
        : (this.doc.scenes ?? []).find((s) => s.audios.includes(src as any))?.audios
      arr?.push(copy)
      this.commit()
      return copy
    },

    bumpTrack(id: string, delta: number) {
      const v = this.visualById(id)
      if (!v) return
      v.track = Math.max(0, (v.track ?? 0) + delta)
      this.commit()
    },

    /* ---------------- split at playhead ---------------- */
    splitVisualAt(id: string, t: number): VisualDoc | undefined {
      const v = this.visualById(id)
      if (!v) return
      const duration = this.defaults.duration
      const timing = resolveVisualTiming(v, duration)
      if (t <= timing.enterBegin + 0.01 || t >= timing.exitEnd - 0.01) return

      const right = { ...clone(v), _id: makeId('vis') } as VisualDoc
      // left keeps enter*, gets cut at t
      this.patchVisual(
        id,
        { exitEnd: round3(t), exitBegin: Math.min(timing.exitBegin, round3(t)) },
        false
      )
      // right starts at t
      right.enterBegin = round3(t)
      right.enterEnd = round3(t)
      delete (right as any).enterAnimation
      if (canonicalVisualType(v.type) === 'VIDEO') {
        const speed = v.speed ?? 1
        const vb = v.videoBegin ?? 0
        right.videoBegin = round3(vb + (t - timing.enterBegin) * speed)
        if (right.id) right.id = `${right.id}-b`
      }
      const arr = this.doc.visuals.find((x) => x._id === id)
        ? this.doc.visuals
        : (this.doc.scenes ?? []).find((s) => s.visuals.some((x) => x._id === id))
            ?.visuals
      arr?.push(right)
      this.commit()
      return right
    },

    splitAudioAt(id: string, t: number): AudioDoc | undefined {
      const a = this.audioById(id)
      if (!a) return
      const enter = a.enter ?? 0
      const exit = a.exit ?? this.defaults.duration
      if (t <= enter + 0.01 || t >= exit - 0.01) return
      const right = { ...clone(a), _id: makeId('aud') } as AudioDoc
      this.patchAudio(id, { exit: round3(t) }, false)
      right.enter = round3(t)
      const speed = a.speed ?? 1
      right.audioBegin = round3((a.audioBegin ?? 0) + (t - enter) * speed)
      const arr = this.doc.audios.find((x) => x._id === id)
        ? this.doc.audios
        : (this.doc.scenes ?? []).find((s) => s.audios.some((x) => x._id === id))
            ?.audios
      arr?.push(right)
      this.commit()
      return right
    },

    /* ---------------- subtitle ---------------- */
    ensureSubtitle(): RawSubtitle {
      if (!this.doc.subtitle) this.doc.subtitle = { captions: [] }
      if (!this.doc.subtitle.captions) this.doc.subtitle.captions = []
      return this.doc.subtitle
    },
    patchSubtitleStyles(patch: Record<string, any>) {
      const sub = this.ensureSubtitle()
      sub.styles = { ...(sub.styles ?? {}) }
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete (sub.styles as any)[k]
        else (sub.styles as any)[k] = v
      }
      this.commit()
    },

    /* ---------------- scenes ---------------- */
    addScene(afterIndex?: number): SceneDoc {
      if (!this.doc.scenes) this.doc.scenes = []
      const scenes = this.doc.scenes
      const scene: SceneDoc = {
        _id: makeId('scn'),
        id: uniqueSceneId(scenes),
        duration: 5,
        visuals: [],
        audios: [],
      }
      const at = afterIndex === undefined ? scenes.length : afterIndex + 1
      scenes.splice(at, 0, scene)
      this.reconcileSceneTransitions()
      this.commit()
      return scene
    },
    removeScene(editorId: string) {
      const scenes = this.doc.scenes
      if (!scenes) return
      const i = scenes.findIndex((s) => s._id === editorId)
      if (i >= 0) scenes.splice(i, 1)
      if (!scenes.length) delete this.doc.scenes
      else this.reconcileSceneTransitions()
      this.commit()
    },
    moveScene(editorId: string, delta: number) {
      const scenes = this.doc.scenes
      if (!scenes) return
      const i = scenes.findIndex((s) => s._id === editorId)
      const j = i + delta
      if (i < 0 || j < 0 || j >= scenes.length) return
      const [s] = scenes.splice(i, 1)
      scenes.splice(j, 0, s)
      this.reconcileSceneTransitions()
      this.commit()
    },
    patchScene(editorId: string, patch: Record<string, any>, commit = true) {
      const s = this.sceneByEditorId(editorId)
      if (!s) return
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete (s as any)[k]
        else (s as any)[k] = v
      }
      if (patch.transition !== undefined || patch.id !== undefined)
        this.reconcileSceneTransitions()
      if (commit) this.commit()
    },
    /** Keep every scene's transitionId pointing at the next scene. */
    reconcileSceneTransitions() {
      const scenes = this.doc.scenes ?? []
      scenes.forEach((s, i) => {
        const next = scenes[i + 1]
        if (s.transition && next) s.transitionId = next.id
        else if (s.transition && !next) {
          delete (s as any).transition
          delete (s as any).transitionId
          delete (s as any).transitionDuration
        } else {
          delete (s as any).transitionId
        }
      })
    },
    /** Convert a flat project into a single scene. */
    convertToScenes() {
      if (this.doc.scenes?.length) return
      const scene: SceneDoc = {
        _id: makeId('scn'),
        id: 'scene-0',
        duration: this.doc.duration ?? 10,
        visuals: this.doc.visuals,
        audios: this.doc.audios,
      }
      this.doc.scenes = [scene]
      this.doc.visuals = []
      this.doc.audios = []
      this.commit()
    },
    /** Flatten scenes into the root timeline using scene start offsets. */
    flattenScenes(startsBySceneId: Record<string, number>) {
      const scenes = this.doc.scenes
      if (!scenes?.length) return
      for (const s of scenes) {
        const offset = startsBySceneId[s._id] ?? 0
        for (const v of s.visuals) {
          const shift = (k: string) => {
            if ((v as any)[k] !== undefined) (v as any)[k] = round3((v as any)[k] + offset)
          }
          v.enterBegin = round3((v.enterBegin ?? 0) + offset)
          shift('enterEnd')
          shift('exitBegin')
          shift('exitEnd')
          this.doc.visuals.push(v)
        }
        for (const a of s.audios) {
          a.enter = round3((a.enter ?? 0) + offset)
          if (a.exit !== undefined) a.exit = round3(a.exit + offset)
          this.doc.audios.push(a)
        }
      }
      delete this.doc.scenes
      this.commit()
    },
  },
})

function round3(v: number) {
  return Math.round(v * 1000) / 1000
}

function uniqueSceneId(scenes: SceneDoc[]): string {
  let i = scenes.length
  let id = `scene-${i}`
  const ids = new Set(scenes.map((s) => s.id))
  while (ids.has(id)) {
    i += 1
    id = `scene-${i}`
  }
  return id
}

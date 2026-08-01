import { useProjectStore } from '~/stores/project'
import { useEditorStore } from '~/stores/editor'

/**
 * Replace-image mode: armed by editor.startReplaceImage(id) (context menu /
 * Layers panel). While armed, the media panels and the stage drop zone route
 * the next picked image here instead of adding a new element.
 */

/** Remembered after a successful replace so the trailing click of a
 *  double-click (or a duplicate drop event) doesn't add a stray copy. */
let lastReplace: { src: string; at: number } | null = null
const DOUBLE_PICK_WINDOW_MS = 700

export function useMediaReplace() {
  const project = useProjectStore()
  const editor = useEditorStore()

  /**
   * If replace mode is armed and this pick can fulfil it, swap the target's
   * src in place — every other attribute is kept — and return true (the
   * caller must not add a new element). Also returns true for the immediate
   * re-pick of the same src (double-click), which is swallowed silently.
   */
  function tryReplace(kind: string, src: string): boolean {
    // panels pass 'image'/'IMAGE' (uploads vs stock-drag payloads)
    if (String(kind).toLowerCase() !== 'image') return false
    const id = editor.replaceTargetId
    if (!id) {
      // not armed: swallow only the echo of a replace that just happened
      return (
        !!lastReplace &&
        lastReplace.src === src &&
        Date.now() - lastReplace.at < DOUBLE_PICK_WINDOW_MS
      )
    }
    const target = project.visualById(id)
    if (!target) {
      // the armed visual was deleted meanwhile — fall back to a normal add
      editor.cancelReplace()
      return false
    }
    project.patchVisual(id, { src })
    lastReplace = { src, at: Date.now() }
    editor.cancelReplace()
    editor.selectVisual(id)
    editor.notify('Image replaced — size, position and effects kept', 'success')
    return true
  }

  return { tryReplace }
}

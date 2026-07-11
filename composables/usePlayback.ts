import { watch, onBeforeUnmount } from 'vue'
import { useEditorStore } from '~/stores/editor'

/**
 * True when every media element currently visible on the stage can render a
 * frame. Errored elements don't gate (their failure overlay is the "frame"),
 * and neither do elements hidden by v-show (off-window items, hidden scenes).
 */
export function stageMediaReady(): boolean {
  const frame = document.querySelector('.stage-frame')
  if (!frame) return true
  const visible = (el: HTMLElement) =>
    el.checkVisibility ? el.checkVisibility() : el.offsetParent !== null
  for (const v of frame.querySelectorAll('video')) {
    if (v.error || !visible(v)) continue
    if (v.readyState < 2 /* HAVE_CURRENT_DATA */) return false
  }
  for (const img of frame.querySelectorAll('img')) {
    if (!visible(img)) continue
    // a failed <img> reports complete=true, so errors never gate here
    if (!img.complete) return false
  }
  return true
}

/**
 * requestAnimationFrame playback clock (M5). Started once from the shell.
 * `durationFn` supplies the current context duration reactively.
 */
/** longest the clock will wait on one buffering stretch — a URL that hangs
 *  without ever erroring must not freeze the player forever */
const GATE_LIMIT_MS = 10_000

export function usePlayback(durationFn: () => number) {
  const editor = useEditorStore()
  let raf = 0
  let lastTs = 0
  let gateSince = 0

  function tick(ts: number) {
    if (!editor.playing) return
    // hold the clock (no dt accumulates) while visible media is buffering —
    // playback must never run ahead of a video/image that can't show yet
    if (stageMediaReady()) {
      gateSince = 0
    } else {
      if (!gateSince) gateSince = ts
      if (ts - gateSince < GATE_LIMIT_MS) {
        lastTs = ts
        raf = requestAnimationFrame(tick)
        return
      }
    }
    if (!lastTs) lastTs = ts
    const dt = ((ts - lastTs) / 1000) * editor.playbackRate
    lastTs = ts
    const duration = Math.max(0.1, durationFn())
    let next = editor.playhead + dt
    if (next >= duration) {
      if (editor.loop) next = 0
      else {
        next = duration
        editor.playing = false
      }
    }
    editor.playhead = next
    if (editor.playing) raf = requestAnimationFrame(tick)
  }

  watch(
    () => editor.playing,
    (playing) => {
      cancelAnimationFrame(raf)
      lastTs = 0
      gateSince = 0
      if (playing) {
        // restart from 0 when pressing play at the very end
        if (editor.playhead >= durationFn() - 0.02) editor.playhead = 0
        raf = requestAnimationFrame(tick)
      }
    }
  )

  onBeforeUnmount(() => cancelAnimationFrame(raf))
}

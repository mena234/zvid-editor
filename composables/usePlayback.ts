import { watch, onBeforeUnmount } from 'vue'
import { useEditorStore } from '~/stores/editor'

/**
 * requestAnimationFrame playback clock (M5). Started once from the shell.
 * `durationFn` supplies the current context duration reactively.
 */
export function usePlayback(durationFn: () => number) {
  const editor = useEditorStore()
  let raf = 0
  let lastTs = 0

  function tick(ts: number) {
    if (!editor.playing) return
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
      if (playing) {
        // restart from 0 when pressing play at the very end
        if (editor.playhead >= durationFn() - 0.02) editor.playhead = 0
        raf = requestAnimationFrame(tick)
      }
    }
  )

  onBeforeUnmount(() => cancelAnimationFrame(raf))
}

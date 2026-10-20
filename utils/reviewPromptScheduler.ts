/**
 * An output interaction creates a single opportunity, never a render-complete
 * event. Wait for five uninterrupted idle seconds after the result is closed.
 */
export function createReviewPromptScheduler(options: {
  isSafe: () => boolean
  show: () => Promise<void>
  now?: () => number
  idleMs?: number
}) {
  const now = options.now ?? Date.now
  const idleMs = options.idleMs ?? 5000
  let timer: ReturnType<typeof setTimeout> | null = null
  let queued = false
  let idleSince = 0
  let expiresAt = 0

  function cancel() {
    queued = false
    if (timer) clearTimeout(timer)
    timer = null
  }

  function activity() {
    idleSince = now()
  }

  function tick() {
    timer = null
    if (!queued) return
    if (now() >= expiresAt) return cancel()
    if (!options.isSafe()) idleSince = now()
    else if (now() - idleSince >= idleMs) {
      queued = false
      void options.show()
      return
    }
    timer = setTimeout(tick, 500)
  }

  function queue() {
    cancel()
    queued = true
    idleSince = now()
    // Do not surprise someone with a stale invitation much later in a session.
    expiresAt = now() + 10 * 60 * 1000
    timer = setTimeout(tick, 500)
  }

  return { queue, cancel, activity }
}

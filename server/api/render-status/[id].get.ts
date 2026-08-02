/**
 * Poll a render job's status. Fallback for the Socket.IO taskComplete /
 * taskFailed events: the render keeps running server-side, so a dropped
 * socket must not leave the render modal spinning at 100% forever.
 * Proxies orch's job snapshot (owner-scoped): { id, state, progress,
 * result, failedReason, ts } where result is the output URL (string) or
 * the sanitized return value object.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  return await orchAction(
    event,
    `/jobs/${encodeURIComponent(id || '')}`,
    { method: 'GET' },
    'Could not read the render status'
  )
})

/**
 * Admin: re-render an example and republish its library row.
 * Forwards the edited content to orch's admin endpoint (cookie → Bearer). orch
 * validates + enqueues an internal render and returns { jobId, clientRoom };
 * progress + the final published item arrive over the render Socket.IO room.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  const body = await readBody(event)
  return await orchAction(
    event,
    `/admin/library/examples/${encodeURIComponent(slug || '')}/render-publish`,
    { method: 'POST', body },
    'Could not render & publish the example'
  )
})

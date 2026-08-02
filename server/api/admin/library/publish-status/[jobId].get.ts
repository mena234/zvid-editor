/**
 * Admin: poll a render-publish job's status. Fallback for the Socket.IO
 * examplePublished/examplePublishFailed events — the flow runs server-side
 * after the 202, so a dropped socket must not hide the terminal outcome.
 * Proxies orch's snapshot: { jobId, state, slug, version?, item?, error? }.
 */
export default defineEventHandler(async (event) => {
  const jobId = getRouterParam(event, 'jobId')
  return await orchAction(
    event,
    `/admin/library/examples/publish-status/${encodeURIComponent(jobId || '')}`,
    { method: 'GET' },
    'Could not read the publish status'
  )
})

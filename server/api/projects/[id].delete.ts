/** Delete a cloud project. */
export default defineEventHandler((event) =>
  orchAction(
    event,
    `/projects/${encodeURIComponent(getRouterParam(event, 'id') || '')}`,
    { method: 'DELETE' },
    'Failed to delete project'
  )
)

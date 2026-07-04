/** Fetch one cloud project (including its JSON payload). */
export default defineEventHandler((event) =>
  orchAction(
    event,
    `/projects/${encodeURIComponent(getRouterParam(event, 'id') || '')}`,
    {},
    'Failed to load project'
  )
)

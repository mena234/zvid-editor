/** Fetch one template (deep link ?template=tpl_… from the dashboard). */
export default defineEventHandler((event) =>
  orchAction(
    event,
    `/templates/${encodeURIComponent(getRouterParam(event, 'id') || '')}`,
    {},
    'Failed to load template'
  )
)

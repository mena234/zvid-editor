/**
 * Admin: fetch one library example's metadata including admin-hidden items
 * (the public /api/library routes only serve active ones). Used by the
 * ?example= deep link so hidden examples stay editable. orch enforces the
 * admin requirement (cookie → Bearer).
 */
export default defineEventHandler((event) =>
  orchAction(
    event,
    `/admin/library/examples/${encodeURIComponent(
      getRouterParam(event, 'slug') || ''
    )}`,
    {},
    'Could not load the example'
  )
)

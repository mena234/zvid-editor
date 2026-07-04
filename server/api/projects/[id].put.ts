/** Update a cloud project (rename and/or overwrite its payload). */
export default defineEventHandler(async (event) => {
  const { name, payload } = await readBody(event)
  const body: Record<string, unknown> = {}
  if (name !== undefined) body.name = name
  if (payload !== undefined) body.payload = payload
  return orchAction(
    event,
    `/projects/${encodeURIComponent(getRouterParam(event, 'id') || '')}`,
    { method: 'PUT', body },
    'Failed to save project'
  )
})

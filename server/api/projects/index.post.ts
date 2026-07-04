/** Save the current editor document as a new cloud project. */
export default defineEventHandler(async (event) => {
  const { name, payload } = await readBody(event)
  return orchAction(
    event,
    '/projects',
    { method: 'POST', body: { name, payload } },
    'Failed to save project'
  )
})

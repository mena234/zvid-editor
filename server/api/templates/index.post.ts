/**
 * Save the current editor document as a render template in the user's
 * account. orch validates against plan limits at save time, so the envelope
 * forwards message + details for the modal to display.
 */
export default defineEventHandler(async (event) => {
  const { name, description, payload } = await readBody(event)
  return orchAction(
    event,
    '/templates',
    { method: 'POST', body: { name, description, payload } },
    'Failed to save template'
  )
})

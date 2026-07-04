/** List the signed-in user's cloud projects. */
export default defineEventHandler((event) =>
  orchAction(
    event,
    '/projects',
    { query: getQuery(event) },
    'Failed to load projects'
  )
)

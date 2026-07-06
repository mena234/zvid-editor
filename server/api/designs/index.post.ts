import { orchApi } from '../../utils/orchAuth'

/** Save a Design Studio creation to the user's design stock. */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  return orchApi(event, '/designs', { method: 'POST', body })
})

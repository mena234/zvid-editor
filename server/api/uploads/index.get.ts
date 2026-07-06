import { orchApi } from '../../utils/orchAuth'

/**
 * List the signed-in user's uploads (optionally ?type=image|video|audio|gif).
 * 401 from orch propagates so the panel can show its sign-in hint.
 */
export default defineEventHandler(async (event) => {
  return orchApi(event, '/uploads', { query: getQuery(event) as any })
})

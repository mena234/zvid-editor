import { orchApi } from '../../utils/orchAuth'

/** List the signed-in user's saved designs (their "design stock"). */
export default defineEventHandler(async (event) => {
  return orchApi(event, '/designs')
})

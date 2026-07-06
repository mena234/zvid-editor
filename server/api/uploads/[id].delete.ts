import { orchApi } from '../../utils/orchAuth'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  return orchApi(event, `/uploads/${encodeURIComponent(id || '')}`, {
    method: 'DELETE',
  })
})

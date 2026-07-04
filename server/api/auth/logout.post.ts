export default defineEventHandler((event) => {
  clearAuthCookie(event)
  return { success: true }
})

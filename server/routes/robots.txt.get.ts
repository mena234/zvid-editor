export default defineEventHandler((event) => {
  setHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  setHeader(event, 'Cache-Control', 'public, max-age=3600')

  // Crawlers must be able to fetch editor pages long enough to observe the
  // sitewide noindex directive. Do not disallow the editor in robots.txt.
  return 'User-agent: *\nAllow: /\n'
})

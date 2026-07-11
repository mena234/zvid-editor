/**
 * Static fixture server for E2E media: CORS-open, supports HTTP Range
 * requests (Chrome requires Range for <video> seeking). Serves
 * tests/e2e/fixtures on FIXTURE_PORT.
 */
import { createServer } from 'node:http'
import { statSync, createReadStream, existsSync } from 'node:fs'
import { join, normalize, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')

const MIME = {
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.mp3': 'audio/mpeg',
  '.svg': 'image/svg+xml',
  '.srt': 'text/plain',
  '.vtt': 'text/vtt',
  '.json': 'application/json',
}

export function startFixtureServer(port) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    const urlPath = decodeURIComponent(url.pathname)
    // ?delay=ms defers the response — lets specs simulate slow media
    const delay = Math.min(Number(url.searchParams.get('delay')) || 0, 10_000)
    const file = normalize(join(ROOT, urlPath)).replace(/\\/g, '/')
    if (!file.startsWith(ROOT.replace(/\\/g, '/')) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { 'Access-Control-Allow-Origin': '*' })
      return res.end('not found')
    }
    const size = statSync(file).size
    const ext = file.slice(file.lastIndexOf('.'))
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    }
    const respond = () => {
      const range = req.headers.range
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range)
        let start = m[1] ? parseInt(m[1], 10) : 0
        let end = m[2] ? parseInt(m[2], 10) : size - 1
        if (start >= size) {
          res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}` })
          return res.end()
        }
        end = Math.min(end, size - 1)
        res.writeHead(206, {
          ...headers,
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Content-Length': end - start + 1,
        })
        createReadStream(file, { start, end }).pipe(res)
      } else {
        res.writeHead(200, { ...headers, 'Content-Length': size })
        createReadStream(file).pipe(res)
      }
    }
    if (delay) setTimeout(respond, delay)
    else respond()
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

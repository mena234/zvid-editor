import { createServer, get, type Server } from 'node:http'
import { createApp, eventHandler, toNodeListener } from 'h3'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

describe('production editor auth cookies', () => {
  let server: Server
  let origin: string

  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { setAuthCookie, clearAuthCookie } = await import('../../server/utils/orchAuth')
    const app = createApp()
    app.use(eventHandler((event) => {
      if (event.path === '/logout') clearAuthCookie(event)
      else setAuthCookie(event, 'test-session')
      return { success: true }
    }))
    server = createServer(toNodeListener(app))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as { port: number }
    origin = `http://127.0.0.1:${address.port}`
  })

  afterAll(async () => {
    if (server) await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()))
    vi.unstubAllEnvs()
  })

  async function cookie(host: string, path = '/login', headers: Record<string, string> = {}) {
    // Node fetch replaces Host, so use HTTP directly to exercise each origin.
    return new Promise<string>((resolve, reject) => {
      get(origin + path, { headers: { host, ...headers } }, response => {
        response.resume()
        response.on('end', () => resolve(response.headers['set-cookie']![0]))
      }).on('error', reject)
    })
  }

  it.each(['127.0.0.1:4318', '127.0.0.2:4318', 'localhost:4318', 'preview.localhost:4318', '[::1]:4318'])(
    'keeps HTTP loopback cookies usable on %s', async host => {
      const value = await cookie(host)
      expect(value).toContain('auth_token=test-session')
      expect(value).toContain('HttpOnly')
      expect(value).toContain('SameSite=Lax')
      expect(value).not.toContain('Domain=')
      expect(value).not.toContain('Secure')
      const cleared = await cookie(host, '/logout')
      expect(cleared).toContain('Max-Age=0')
      expect(cleared).not.toContain('Domain=')
    }
  )

  it.each(['editor.zvid.io', 'zvid.io'])(
    'retains the shared secure production cookie on %s', async host => {
      for (const path of ['/login', '/logout']) {
        const value = await cookie(host, path, { 'x-forwarded-proto': 'https' })
        expect(value).toContain('Domain=.zvid.io')
        expect(value).toContain('Secure')
        expect(value).toContain('HttpOnly')
      }
    }
  )

  it.each(['preview.example.test', 'notzvid.io', 'zvid.io.example.test'])(
    'keeps non-loopback production cookies secure and host-only on %s', async host => {
      const value = await cookie(host)
      expect(value).toContain('Secure')
      expect(value).not.toContain('Domain=')
    }
  )

  it('does not use forwarded host headers to allow insecure production cookies', async () => {
    const value = await cookie('editor.zvid.io', '/login', { 'x-forwarded-host': 'localhost' })
    expect(value).toContain('Secure')
    expect(value).toContain('Domain=.zvid.io')
  })

  it('keeps HTTPS loopback cookies secure', async () => {
    expect(await cookie('localhost', '/login', { 'x-forwarded-proto': 'https' })).toContain('Secure')
  })
})

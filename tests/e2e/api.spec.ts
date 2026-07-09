import { test, expect } from '@playwright/test'
import { resetMockOrch, MOCK_ORCH, VALID_TOKEN } from './helpers/app'

/**
 * Server-route (Nitro) tests over HTTP — the editor's orch proxy layer
 * (server/api/**, server/utils/orchAuth.ts) against the scriptable mock orch.
 * Auth model: the mock accepts Bearer "tok-valid" only.
 */

const AUTH = { Cookie: `auth_token=${VALID_TOKEN}` }
const BAD_AUTH = { Cookie: 'auth_token=tok-nope' }

test.beforeEach(async () => {
  await resetMockOrch()
})

test.describe('session & auth', () => {
  test('session without cookie returns nulls, never errors', async ({ request }) => {
    const res = await request.get('/api/session')
    expect(res.status()).toBe(200)
    expect(await res.json()).toEqual({ user: null, credits: null, plan: null })
  })

  test('session with valid cookie returns profile', async ({ request }) => {
    const res = await request.get('/api/session', { headers: AUTH })
    const body = await res.json()
    expect(body.user.email).toBe('e2e@zvid.io')
    expect(body.plan).toEqual({ name: 'Pro', isPaid: true })
    expect(body.credits.balance).toBe(500)
  })

  test('session with invalid token degrades to logged-out, not an error', async ({
    request,
  }) => {
    const res = await request.get('/api/session', { headers: BAD_AUTH })
    expect(res.status()).toBe(200)
    expect((await res.json()).user).toBeNull()
  })

  test('login sets the httpOnly auth cookie', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      data: { email: 'e2e@zvid.io', password: 'pw' },
    })
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.user.email).toBe('e2e@zvid.io')
    const setCookie = res.headers()['set-cookie'] || ''
    expect(setCookie).toContain(`auth_token=${VALID_TOKEN}`)
    expect(setCookie.toLowerCase()).toContain('httponly')
  })

  test('login failure returns a friendly envelope, no cookie', async ({ request }) => {
    await resetMockOrch({ loginOk: false })
    const res = await request.post('/api/auth/login', {
      data: { email: 'e2e@zvid.io', password: 'wrong' },
    })
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error).toBe('Wrong email or password')
    expect(res.headers()['set-cookie'] || '').not.toContain('tok-valid')
  })

  test('logout clears the cookie', async ({ request }) => {
    const res = await request.post('/api/auth/logout')
    expect((await res.json()).success).toBe(true)
    const setCookie = res.headers()['set-cookie'] || ''
    expect(setCookie).toMatch(/auth_token=;/)
  })
})

test.describe('probe (local ffprobe)', () => {
  test('probes the fixture video', async ({ request }) => {
    const res = await request.get('/api/probe?src=http://127.0.0.1:4598/clip.mp4')
    const meta = await res.json()
    expect(meta.width).toBe(320)
    expect(meta.height).toBe(180)
    expect(meta.duration).toBeGreaterThan(1.8)
    expect(meta.duration).toBeLessThan(2.3)
    expect(meta.hasAudio).toBe(true)
  })

  test('rejects non-http sources', async ({ request }) => {
    const res = await request.get('/api/probe?src=file:///C:/x.mp4')
    expect(res.status()).toBe(400)
  })
})

test.describe('projects CRUD (orchAction envelopes)', () => {
  test('unauthenticated list returns success:false 401 envelope', async ({ request }) => {
    const res = await request.get('/api/projects')
    expect(res.status()).toBe(200) // envelope, not an HTTP error
    const body = await res.json()
    expect(body).toMatchObject({ success: false, status: 401 })
  })

  test('create → list → get → rename → delete round-trip', async ({ request }) => {
    const created = await (
      await request.post('/api/projects', {
        headers: AUTH,
        data: { name: 'My project', payload: { duration: 5 } },
      })
    ).json()
    expect(created.success).toBe(true)
    const id = created.project.id

    const list = await (await request.get('/api/projects', { headers: AUTH })).json()
    expect(list.projects.map((p: any) => p.id)).toContain(id)

    const got = await (
      await request.get(`/api/projects/${id}`, { headers: AUTH })
    ).json()
    expect(got.project.payload).toEqual({ duration: 5 })

    const renamed = await (
      await request.put(`/api/projects/${id}`, {
        headers: AUTH,
        data: { name: 'Renamed' },
      })
    ).json()
    expect(renamed.success).toBe(true)
    expect(renamed.project.name).toBe('Renamed')

    const del = await (
      await request.delete(`/api/projects/${id}`, { headers: AUTH })
    ).json()
    expect(del.success).toBe(true)
    const after = await (await request.get('/api/projects', { headers: AUTH })).json()
    expect(after.projects.map((p: any) => p.id)).not.toContain(id)
  })

  test('missing project maps orch 404 into the envelope', async ({ request }) => {
    const body = await (
      await request.get('/api/projects/prj_ghost', { headers: AUTH })
    ).json()
    expect(body.success).toBe(false)
    expect(body.status).toBe(404)
    expect(body.error).toBe('Project not found')
  })
})

test.describe('templates', () => {
  test('save + fetch template', async ({ request }) => {
    const saved = await (
      await request.post('/api/templates', {
        headers: AUTH,
        data: { name: 'Tpl', description: 'd', payload: { duration: 3 } },
      })
    ).json()
    expect(saved.success).toBe(true)
    const got = await (
      await request.get(`/api/templates/${saved.template.id}`, { headers: AUTH })
    ).json()
    // orch serves the doc back under template.project (payload is the send alias)
    expect(got.template.project).toEqual({ duration: 3 })
  })

  test('unauthenticated save is a 401 envelope', async ({ request }) => {
    const body = await (
      await request.post('/api/templates', { data: { name: 'x', payload: {} } })
    ).json()
    expect(body).toMatchObject({ success: false, status: 401 })
  })
})

test.describe('uploads', () => {
  test('list requires auth (401 propagates as HTTP error)', async ({ request }) => {
    const res = await request.get('/api/uploads')
    expect(res.status()).toBe(401)
  })

  test('authed list returns uploads + usage', async ({ request }) => {
    await resetMockOrch({
      uploads: [
        {
          id: 'upl_1',
          kind: 'image',
          fileName: 'a.png',
          mimeType: 'image/png',
          sizeBytes: 3479,
          url: 'http://127.0.0.1:4598/image.png',
        },
      ],
    })
    const body = await (await request.get('/api/uploads', { headers: AUTH })).json()
    expect(body.uploads).toHaveLength(1)
    expect(body.usage).toBeTruthy()
  })

  test('multipart upload without auth is rejected before proxying', async ({
    request,
  }) => {
    const res = await request.post('/api/uploads', {
      multipart: { file: { name: 'x.png', mimeType: 'image/png', buffer: Buffer.from('x') } },
    })
    expect(res.status()).toBe(401)
  })

  test('authed multipart upload proxies through', async ({ request }) => {
    const res = await request.post('/api/uploads', {
      headers: AUTH,
      multipart: { file: { name: 'x.png', mimeType: 'image/png', buffer: Buffer.from('x') } },
    })
    expect(res.status()).toBe(200)
    expect((await res.json()).upload.id).toMatch(/^upl_/)
  })

  test('delete forwards to orch', async ({ request }) => {
    await resetMockOrch({ uploads: [{ id: 'upl_9', kind: 'image', fileName: 'z' }] })
    const res = await request.delete('/api/uploads/upl_9', { headers: AUTH })
    expect(res.status()).toBe(200)
    const state = await (await fetch(`${MOCK_ORCH}/__mock/state`)).json()
    expect(state.uploads).toHaveLength(0)
  })
})

test.describe('designs', () => {
  test('CRUD passthrough with auth', async ({ request }) => {
    const saved = await (
      await request.post('/api/designs', {
        headers: AUTH,
        data: { name: 'D1', design: { version: 1, layers: [] } },
      })
    ).json()
    expect(saved.design.id).toMatch(/^dsn_/)
    const list = await (await request.get('/api/designs', { headers: AUTH })).json()
    expect(list.designs).toHaveLength(1)
    const res = await request.delete(`/api/designs/${saved.design.id}`, { headers: AUTH })
    expect(res.status()).toBe(200)
  })

  test('unauthed design list is a 401 error', async ({ request }) => {
    const res = await request.get('/api/designs')
    expect(res.status()).toBe(401)
  })
})

test.describe('stock', () => {
  test('providers proxy', async ({ request }) => {
    const body = await (await request.get('/api/stock/providers')).json()
    expect(body.image).toEqual(['pexels'])
  })

  test('search proxies pages', async ({ request }) => {
    await resetMockOrch({
      stockPages: {
        image: [[{ id: 'a', provider: 'pexels' }], [{ id: 'b', provider: 'pexels' }]],
      },
    })
    const p1 = await (
      await request.get('/api/stock/search?type=image&query=cat&page=1')
    ).json()
    expect(p1.items.map((i: any) => i.id)).toEqual(['a'])
    expect(p1.hasMore).toBe(true)
    const p2 = await (
      await request.get('/api/stock/search?type=image&query=cat&page=2')
    ).json()
    expect(p2.items.map((i: any) => i.id)).toEqual(['b'])
    expect(p2.hasMore).toBe(false)
  })

  test('provider failure maps to a clean HTTP error', async ({ request }) => {
    await resetMockOrch({ stockError: 'pixabay quota exceeded' })
    const res = await request.get('/api/stock/search?type=image&query=cat')
    expect(res.status()).toBe(502)
  })
})

test.describe('library', () => {
  test('list, search filter, and content passthrough', async ({ request }) => {
    await resetMockOrch({
      library: {
        examples: [
          { kind: 'examples', slug: 'demo-a', title: 'Demo A', description: null, meta: {}, version: 1, sortOrder: 0, contentUrl: '' },
          { kind: 'examples', slug: 'promo-b', title: 'Promo B', description: null, meta: {}, version: 1, sortOrder: 1, contentUrl: '' },
        ],
      },
      libraryContent: { 'examples/demo-a': { name: 'demo', duration: 4 } },
    })
    const list = await (await request.get('/api/library/examples')).json()
    expect(list.items).toHaveLength(2)

    const filtered = await (await request.get('/api/library/examples?q=promo')).json()
    expect(filtered.items.map((i: any) => i.slug)).toEqual(['promo-b'])

    const content = await (
      await request.get('/api/library/examples/demo-a/content')
    ).json()
    expect(content).toEqual({ name: 'demo', duration: 4 })
  })

  test('missing content maps orch 404 through', async ({ request }) => {
    const res = await request.get('/api/library/examples/ghost/content')
    expect(res.status()).toBe(404)
  })
})

test.describe('fonts', () => {
  test('invalid family is rejected before any network fetch', async ({ request }) => {
    const res = await request.get('/api/fonts?family=<script>')
    expect(res.status()).toBe(400)
  })
})

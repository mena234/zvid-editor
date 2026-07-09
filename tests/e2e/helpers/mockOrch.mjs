/**
 * Mock orch API + render socket for the editor test suite.
 *
 * Implements every orch endpoint the editor's server routes proxy to
 * (see server/utils/orchAuth.ts — all under /api, Bearer auth) plus the
 * Socket.IO /frontend namespace used by RenderModal.
 *
 * Scriptable per test via control endpoints on the same port:
 *   POST /__mock/reset   { state overrides }   → resets to defaults + overrides
 *   GET  /__mock/state                          → current mutable state
 *   GET  /__mock/calls                          → [{method,path,auth,body}]
 *
 * Auth model: token "tok-valid" ⇒ the test user; anything else ⇒ 401.
 */
import { createServer } from 'node:http'
import { Server as SocketIOServer } from 'socket.io'

export const VALID_TOKEN = 'tok-valid'

const defaultState = () => ({
  user: { id: 'usr_1', email: 'e2e@zvid.io', name: 'E2E Tester' },
  // orch shapes: creditService.getUserCredits → { balance, … };
  // user.controller profile → plan { name, isPaid }
  credits: { balance: 500, total_earned: 600, total_spent: 100 },
  plan: { name: 'Pro', isPaid: true },
  loginOk: true,
  projects: [],
  templates: [],
  uploads: [],
  designs: [],
  usage: { used: 0, limit: 1024 * 1024 * 1024 },
  /** library[kind] = [{ slug, title, description, meta, version, sortOrder, contentUrl }] */
  library: {},
  /** libraryContent["kind/slug"] = arbitrary JSON */
  libraryContent: {},
  stockProviders: { image: ['pexels'], video: ['pexels'], gif: ['giphy'], audio: ['jamendo'] },
  /** stockPages[kind] = [[items page0], [page1], …] */
  stockPages: {},
  stockError: null,
  /** render behavior: 'progress' (queue→progress→complete), 'fail-ack', 'fail-task' */
  renderMode: 'progress',
  renderResultUrl: 'http://127.0.0.1:4598/clip.mp4',
  nextId: 1,
})

export function startMockOrch(port) {
  let state = defaultState()
  const calls = []

  const readBody = (req) =>
    new Promise((resolve) => {
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        const raw = Buffer.concat(chunks)
        try {
          resolve(raw.length ? JSON.parse(raw.toString('utf8')) : null)
        } catch {
          resolve(raw)
        }
      })
    })

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    const path = url.pathname
    const method = req.method
    const body = await readBody(req)
    const authHeader = req.headers.authorization || ''
    const token = authHeader.replace(/^Bearer\s+/i, '')
    const authed = token === VALID_TOKEN

    const send = (code, data) => {
      res.writeHead(code, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(data))
    }

    // ---- control plane ----
    if (path === '/__mock/reset') {
      state = { ...defaultState(), ...(body || {}) }
      calls.length = 0
      return send(200, { ok: true })
    }
    if (path === '/__mock/state') return send(200, state)
    if (path === '/__mock/calls') return send(200, calls)

    calls.push({ method, path, query: Object.fromEntries(url.searchParams), auth: authed, body })

    const requireAuth = () => {
      if (!authed) {
        send(401, { error: 'unauthorized', message: 'Sign in required' })
        return false
      }
      return true
    }

    // ---- auth / session ----
    if (path === '/api/auth/login' && method === 'POST') {
      if (state.loginOk && body?.email && body?.password) {
        return send(200, { token: VALID_TOKEN, user: state.user })
      }
      return send(401, { error: 'invalid_credentials', message: 'Wrong email or password' })
    }
    if (path === '/api/user/profile') {
      if (!requireAuth()) return
      return send(200, { user: state.user, credits: state.credits, plan: state.plan })
    }

    // ---- projects ----
    if (path === '/api/projects' && method === 'GET') {
      if (!requireAuth()) return
      return send(200, {
        projects: state.projects.map(({ payload, ...meta }) => meta),
      })
    }
    if (path === '/api/projects' && method === 'POST') {
      if (!requireAuth()) return
      const project = {
        id: `prj_${state.nextId++}`,
        name: body?.name || 'Untitled',
        payload: body?.payload ?? null,
        updatedAt: '2026-07-09T00:00:00.000Z',
        createdAt: '2026-07-09T00:00:00.000Z',
      }
      state.projects.unshift(project)
      return send(200, { project: { ...project, payload: undefined } })
    }
    const prjMatch = path.match(/^\/api\/projects\/([^/]+)$/)
    if (prjMatch) {
      if (!requireAuth()) return
      const prj = state.projects.find((p) => p.id === decodeURIComponent(prjMatch[1]))
      if (!prj) return send(404, { error: 'not_found', message: 'Project not found' })
      if (method === 'GET') return send(200, { project: prj })
      if (method === 'PUT') {
        if (body?.name !== undefined) prj.name = body.name
        if (body?.payload !== undefined) prj.payload = body.payload
        return send(200, { project: { ...prj, payload: undefined } })
      }
      if (method === 'DELETE') {
        state.projects = state.projects.filter((p) => p !== prj)
        return send(200, { deleted: true })
      }
    }

    // ---- templates ----
    // orch accepts the doc under "payload" (alias "project") and serves it
    // back under template.project (templateService.mapRow).
    if (path === '/api/templates' && method === 'POST') {
      if (!requireAuth()) return
      const tpl = {
        id: `tpl_${state.nextId++}`,
        name: body?.name || 'Untitled',
        description: body?.description || '',
        project: body?.payload ?? body?.project ?? null,
      }
      state.templates.unshift(tpl)
      return send(200, { template: { id: tpl.id, name: tpl.name } })
    }
    const tplMatch = path.match(/^\/api\/templates\/([^/]+)$/)
    if (tplMatch && method === 'GET') {
      if (!requireAuth()) return
      const tpl = state.templates.find((t) => t.id === decodeURIComponent(tplMatch[1]))
      if (!tpl) return send(404, { error: 'not_found', message: 'Template not found' })
      return send(200, { template: tpl })
    }

    // ---- uploads ----
    // orch item shape (uploadService.mapRow):
    // { id, kind, fileName, mimeType, sizeBytes, width, height, duration, url, createdAt }
    if (path === '/api/uploads' && method === 'GET') {
      if (!requireAuth()) return
      const kind = url.searchParams.get('type')
      const items = kind ? state.uploads.filter((u) => u.kind === kind) : state.uploads
      return send(200, { uploads: items, usage: state.usage })
    }
    if (path === '/api/uploads' && method === 'POST') {
      if (!requireAuth()) return
      const up = {
        id: `upl_${state.nextId++}`,
        kind: 'image',
        fileName: 'uploaded.png',
        mimeType: 'image/png',
        sizeBytes: 3479,
        width: 320,
        height: 240,
        duration: null,
        url: 'http://127.0.0.1:4598/image.png',
        createdAt: '2026-07-09T00:00:00.000Z',
      }
      state.uploads.unshift(up)
      return send(200, { upload: up, usage: state.usage })
    }
    const uplMatch = path.match(/^\/api\/uploads\/([^/]+)$/)
    if (uplMatch && method === 'DELETE') {
      if (!requireAuth()) return
      state.uploads = state.uploads.filter((u) => u.id !== decodeURIComponent(uplMatch[1]))
      return send(200, { deleted: true })
    }

    // ---- designs ----
    if (path === '/api/designs' && method === 'GET') {
      if (!requireAuth()) return
      return send(200, { designs: state.designs })
    }
    if (path === '/api/designs' && method === 'POST') {
      if (!requireAuth()) return
      const d = { id: `dsn_${state.nextId++}`, name: body?.name || 'Design', design: body?.design ?? body }
      state.designs.unshift(d)
      return send(200, { design: d })
    }
    const dsnMatch = path.match(/^\/api\/designs\/([^/]+)$/)
    if (dsnMatch && method === 'DELETE') {
      if (!requireAuth()) return
      state.designs = state.designs.filter((d) => d.id !== decodeURIComponent(dsnMatch[1]))
      return send(200, { deleted: true })
    }

    // ---- stock ----
    if (path === '/api/stock/providers') return send(200, state.stockProviders)
    if (path === '/api/stock/search') {
      if (state.stockError) return send(502, { error: state.stockError })
      const kind = url.searchParams.get('type') || url.searchParams.get('kind') || 'image'
      const page = Number(url.searchParams.get('page') || 1)
      const pages = state.stockPages[kind] || []
      const items = pages[page - 1] || []
      return send(200, { items, hasMore: page < pages.length, providerErrors: [] })
    }

    // ---- library ----
    const libMatch = path.match(/^\/api\/library\/(.+)$/)
    if (libMatch && method === 'GET') {
      const rest = decodeURIComponent(libMatch[1])
      const contentMatch = rest.match(/^([^/]+)\/(.+)\/content$/)
      if (contentMatch) {
        const key = `${contentMatch[1]}/${contentMatch[2]}`
        const content = state.libraryContent[key]
        if (content === undefined) return send(404, { error: 'not_found', message: `no content ${key}` })
        return send(200, content)
      }
      const kind = rest
      let items = state.library[kind] || []
      const q = (url.searchParams.get('q') || '').toLowerCase()
      if (q) {
        items = items.filter((it) =>
          `${it.title} ${it.slug} ${it.description || ''}`.toLowerCase().includes(q)
        )
      }
      const limit = Number(url.searchParams.get('limit') || items.length || 50)
      const offset = Number(url.searchParams.get('offset') || 0)
      const pageItems = items.slice(offset, offset + limit)
      return send(200, {
        kind,
        items: pageItems,
        total: items.length,
        limit,
        offset,
        hasMore: offset + pageItems.length < items.length,
      })
    }

    send(404, { error: 'not_found', message: `mock orch: no route ${method} ${path}` })
  })

  // ---- render socket (/frontend namespace) ----
  const io = new SocketIOServer(server, {
    cors: { origin: true, credentials: true },
  })
  io.of('/frontend').on('connection', (socket) => {
    socket.on('submitTask', (envelope, ack) => {
      if (state.renderMode === 'fail-ack') {
        return ack({ error: 'validation_failed', message: 'Mock rejected the payload' })
      }
      const taskId = `task_${state.nextId++}`
      ack({ taskId, queued: true, queueAhead: 0, creditsReserved: 2 })
      const emit = (ev, data) => socket.emit(ev, data)
      setTimeout(() => emit('taskAssigned', { taskId }), 50)
      setTimeout(() => emit('taskProgress', { taskId, progress: 30 }), 120)
      setTimeout(() => emit('taskProgress', { taskId, progress: 75 }), 220)
      setTimeout(() => {
        if (state.renderMode === 'fail-task') {
          emit('taskFailed', { taskId, error: 'Mock render exploded' })
        } else {
          emit('taskComplete', {
            taskId,
            result: { url: state.renderResultUrl, thumbnailUrl: null },
          })
        }
      }, 320)
    })
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve({ server, io }))
  })
}

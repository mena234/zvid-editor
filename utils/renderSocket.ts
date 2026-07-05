import { io, type Socket } from 'socket.io-client'

/**
 * Render transport: Socket.IO connection to orch's /frontend namespace.
 * orch authenticates the handshake via the shared httpOnly auth_token
 * cookie (withCredentials) — same contract as zvid-dash-nuxt/utils/socket.ts,
 * do not change the handshake.
 *
 * Server → client events (camelized by orch):
 *   taskQueued   { taskId, queued, queueAhead, creditsReserved }
 *   taskWaiting  { taskId }
 *   taskAssigned { taskId }
 *   taskProgress { taskId, progress }        progress: number 0–100
 *   taskComplete { taskId, result: { url, thumbnailUrl, ... } }  url = CDN
 *   taskFailed   { taskId, error }
 *   taskRequeued { taskId }
 */

let socket: Socket | null = null

/**
 * Connect (or reuse) the singleton render socket. Resolves once the
 * handshake succeeds; rejects with the middleware error on auth failure
 * ("unauthorized - …") or when orch is unreachable.
 */
export function connectRenderSocket(clientKey: string): Promise<Socket> {
  if (socket?.connected) return Promise.resolve(socket)

  if (!socket) {
    const config = useRuntimeConfig()
    const base = (config.public.orchUrl as string) || 'http://localhost:4000'
    socket = io(`${base}/frontend`, {
      auth: { clientKey },
      transports: ['websocket', 'polling'],
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    })
  }

  const s = socket
  return new Promise((resolve, reject) => {
    if (s.connected) return resolve(s)
    const onConnect = () => {
      cleanup()
      resolve(s)
    }
    const onError = (err: Error) => {
      cleanup()
      reject(err)
    }
    const cleanup = () => {
      s.off('connect', onConnect)
      s.off('connect_error', onError)
    }
    s.once('connect', onConnect)
    s.once('connect_error', onError)
    s.connect()
  })
}

/** Drop the connection (e.g. after sign-out so the next render re-auths). */
export function disconnectRenderSocket() {
  socket?.disconnect()
  socket = null
}

export interface SubmitAck {
  // success
  taskId?: string
  queued?: boolean
  queueAhead?: number
  creditsReserved?: number
  // failure ({ error, message, details? } — orch's standard error shape)
  error?: string
  message?: string
  details?: { field?: string; message: string }[]
  creditsRequired?: number
  creditsAvailable?: number
}

/**
 * Submit a render job. The envelope is { payload } (full project JSON) —
 * orch resolves variables, validates against plan limits, reserves credits
 * and queues the job. The ack carries either the queued taskId or an error.
 */
export function submitRenderTask(
  s: Socket,
  envelope: { payload: Record<string, any>; jobId?: string }
): Promise<SubmitAck> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('The render service did not respond in time')),
      20000
    )
    s.emit('submitTask', envelope, (ack: SubmitAck) => {
      clearTimeout(timer)
      resolve(ack ?? {})
    })
  })
}

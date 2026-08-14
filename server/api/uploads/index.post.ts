import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'

/**
 * Upload proxy: streams the browser's multipart/form-data body to orch's
 * POST /api/uploads with the httpOnly auth cookie as a Bearer token
 * (orchApi can't be used here — it JSON-encodes bodies).
 *
 * Keep this as a Node stream pipe: buffering the first hop makes browser
 * XHR progress finish before the real proxy-to-orch transfer has started.
 * Node's `pipe` propagates upstream backpressure to the browser connection.
 */
export default defineEventHandler(async (event) => {
  const { orchUrl } = useRuntimeConfig()
  const token = getCookie(event, 'auth_token')
  if (!token) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Not signed in',
      data: { error: 'Sign in to upload media' },
    })
  }

  try {
    const target = new URL('/api/uploads', orchUrl)
    const request = target.protocol === 'https:' ? httpsRequest : httpRequest
    const contentType = getHeader(event, 'content-type')
    const contentLength = getHeader(event, 'content-length')
    const uploadSize = getHeader(event, 'x-upload-size')
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      ...(contentType ? { 'Content-Type': contentType } : {}),
      ...(contentLength ? { 'Content-Length': contentLength } : {}),
      ...(uploadSize ? { 'X-Upload-Size': uploadSize } : {}),
    }

    const upstreamResponse = await new Promise<import('node:http').IncomingMessage>(
      (resolve, reject) => {
        const clientRequest = event.node.req
        const upstreamRequest = request(target, { method: 'POST', headers }, resolve)
        upstreamRequest.once('error', (error) => {
          // Do not destroy the browser socket: leave it available for the 502
          // response, while draining any request bytes that are still arriving.
          clientRequest.unpipe(upstreamRequest)
          clientRequest.resume()
          reject(error)
        })
        clientRequest.once('aborted', () =>
          upstreamRequest.destroy(new Error('Client aborted upload'))
        )
        clientRequest.once('error', (error) => upstreamRequest.destroy(error))
        clientRequest.pipe(upstreamRequest)
      }
    )

    const responseBody = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = []
      upstreamResponse.on('data', (chunk) =>
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      )
      upstreamResponse.once('end', () => resolve(Buffer.concat(chunks)))
      upstreamResponse.once('error', reject)
    })

    event.node.res.statusCode = upstreamResponse.statusCode || 502
    if (upstreamResponse.statusMessage)
      event.node.res.statusMessage = upstreamResponse.statusMessage

    // The upload endpoint returns JSON. Copy only response headers needed by
    // the browser; in particular, never relay orch's Set-Cookie header.
    for (const name of ['content-type', 'content-length', 'retry-after'] as const) {
      const value = upstreamResponse.headers[name]
      if (value !== undefined) event.node.res.setHeader(name, value)
    }
    event.node.res.end(responseBody)
  } catch (err: any) {
    const status = err?.status || err?.response?.status
    if (status) {
      throw createError({
        statusCode: status,
        statusMessage: 'Upload failed',
        data: err?.data || {},
      })
    }
    throw createError({
      statusCode: 502,
      statusMessage: `orch is unreachable at ${orchUrl} — start it (yarn dev in orch/) or set ORCH_URL`,
    })
  }
})

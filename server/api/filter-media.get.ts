import { Transform } from 'node:stream'
import { openFilterMedia } from '../utils/filterMediaSource'

let active = 0
const MAX_BYTES = 256 * 1024 * 1024

/** CORS fallback for canvas and audio preview. No user credentials are sent. */
export default defineEventHandler(async (event) => {
  const src = getQuery(event).src
  if (typeof src !== 'string' || src.length > 8192)
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid media source',
    })
  if (active >= 12)
    throw createError({ statusCode: 429, statusMessage: 'Media preview busy' })
  active++
  const controller = new AbortController()
  const cancel = () => controller.abort()
  const timeout = setTimeout(cancel, 120_000)
  event.node.res.once('close', cancel)
  let response: Awaited<ReturnType<typeof openFilterMedia>> | undefined
  try {
    response = await openFilterMedia(src, getHeader(event, 'range'), controller.signal)
    const status = response.statusCode ?? 502
    if (status !== 200 && status !== 206 && status !== 416)
      throw new Error('Media request failed')
    if (Number(response.headers['content-length']) > MAX_BYTES)
      throw new Error('Media is too large')
    setResponseStatus(event, status)
    // Do not relay cookies, arbitrary headers, or active HTML on the app origin.
    const type = response.headers['content-type'] ?? ''
    setHeader(
      event,
      'content-type',
      /^(image|video|audio)\//i.test(type) ? type : 'application/octet-stream'
    )
    setHeader(event, 'x-content-type-options', 'nosniff')
    setHeader(event, 'content-security-policy', "default-src 'none'; sandbox")
    setHeader(event, 'cache-control', 'private, max-age=300')
    for (const name of ['content-length', 'content-range', 'accept-ranges'] as const)
      if (response.headers[name]) setHeader(event, name, response.headers[name]!)
    let bytes = 0
    const limited = new Transform({
      transform(chunk, _encoding, callback) {
        bytes += chunk.length
        callback(
          bytes > MAX_BYTES ? new Error('Media is too large') : null,
          bytes > MAX_BYTES ? undefined : chunk
        )
      },
    })
    response.once('error', (error) => limited.destroy(error))
    response.pipe(limited)
    await sendStream(event, limited)
  } catch {
    throw createError({
      statusCode: 502,
      statusMessage: 'Media could not be loaded for filter preview',
    })
  } finally {
    clearTimeout(timeout)
    event.node.res.off('close', cancel)
    response?.destroy()
    controller.abort()
    active--
  }
})

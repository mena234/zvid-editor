import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('editor review campaign proxy', () => {
  const forward = vi.fn()
  const readBody = vi.fn()
  const setHeader = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    setHeader.mockReset()
    vi.stubGlobal('setHeader', setHeader)
    vi.stubGlobal('getCookie', vi.fn(() => 'signed-in-cookie'))
    vi.stubGlobal('getHeader', vi.fn(() => 'https://editor.zvid.io'))
    vi.stubGlobal('getRequestURL', vi.fn(() => new URL('https://editor.zvid.io/api/review-campaign')))
    vi.stubGlobal('createError', (details: unknown) => details)
    vi.stubGlobal('orchApi', forward)
    vi.stubGlobal('readBody', readBody)
    forward.mockReset().mockResolvedValue({ canPrompt: false })
    readBody.mockReset().mockResolvedValue({ action: 'opt_out' })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('rejects signed-out requests before reading or forwarding input', async () => {
    vi.stubGlobal('getCookie', () => undefined)
    const { default: handler } = await import('../../server/api/review-campaign.post')
    await expect(handler({} as never)).rejects.toMatchObject({ statusCode: 401 })
    expect(readBody).not.toHaveBeenCalled()
    expect(forward).not.toHaveBeenCalled()
  })

  it('rejects a sibling origin even though it shares the session cookie', async () => {
    vi.stubGlobal('getHeader', () => 'https://other.zvid.io')
    const { default: handler } = await import('../../server/api/review-campaign.post')
    await expect(handler({} as never)).rejects.toMatchObject({ statusCode: 403 })
    expect(readBody).not.toHaveBeenCalled()
    expect(forward).not.toHaveBeenCalled()
  })

  it('forwards only an authenticated same-origin request and disables caching', async () => {
    const { default: handler } = await import('../../server/api/review-campaign.post')
    const event = {} as never
    await expect(handler(event)).resolves.toMatchObject({ canPrompt: false })
    expect(forward).toHaveBeenCalledWith(event, '/user/review-campaign', { method: 'POST', body: { action: 'opt_out' } })
    expect(setHeader).toHaveBeenCalledWith(event, 'Cache-Control', 'private, no-store')
  })
})

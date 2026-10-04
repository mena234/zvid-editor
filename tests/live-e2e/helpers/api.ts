import type { APIRequestContext, APIResponse } from '@playwright/test'
import type { LiveEnvironment } from './env'

export class LiveApi {
  constructor(readonly context: APIRequestContext, readonly env: LiveEnvironment) {}

  async request(path: string, options: { method?: string; data?: unknown; headers?: Record<string, string> } = {}): Promise<APIResponse> {
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('..')) throw new Error('Expected an API-relative path')
    try {
      return await this.context.fetch(`${this.env.apiUrl}/api${path}`, { ...options, timeout: 30_000, failOnStatusCode: false })
    } catch {
      // Request exceptions can include Cookie/Authorization headers. Keep diagnostics safe.
      throw new Error(`Live API request could not complete: ${options.method || 'GET'} ${path.split('?')[0]}`)
    }
  }

  async get(path: string) {
    const response = await this.request(path)
    if (!response.ok()) throw new Error(`Read-only API check failed: ${path.split('?')[0]} (${response.status()})`)
    return response.json()
  }

  async validate(payload: Record<string, unknown>) {
    const response = await this.request('/render/validate', { method: 'POST', data: { payload } })
    if (!response.ok()) throw new Error(`Free render validation failed (${response.status()}); nothing was submitted`)
    const body = await response.json()
    if (body.valid !== true || !Number.isSafeInteger(body.creditsRequired) || body.creditsRequired <= 0)
      throw new Error('Render validation did not return a valid positive credit estimate')
    return body as { valid: true; creditsRequired: number; payload: Record<string, any>; warnings?: unknown[] }
  }

  async balance(): Promise<number> {
    const body = await this.get('/credits/balance')
    if (!Number.isFinite(body.balance) || body.balance < 0) throw new Error('Credit balance is missing or invalid')
    return body.balance
  }

  async noActiveJobs() {
    for (const status of ['waiting', 'processing', 'stalled']) {
      const body = await this.get(`/jobs?status=${status}&limit=1`)
      const items = body.jobs
      if (!Array.isArray(items)) throw new Error('Unexpected job-list response')
      if (items.length) throw new Error('The dedicated account already has unfinished render jobs; do not overlap runs')
    }
  }
}

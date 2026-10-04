import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FullResult, TestCase, TestError, TestResult, TestStep } from '@playwright/test/reporter'

const secrets = vi.hoisted(() => ({
  password: 'synthetic-reporter-password-Ω',
  email: 'synthetic-reporter@example.com',
  apiKey: `zvid_${'a'.repeat(64)}`,
}))

// Exercise reporter boundaries without loading private .env.live or a live fixture.
vi.mock('./helpers/env', () => ({
  redact(text: string) {
    for (const value of Object.values(secrets)) text = text.split(value).join('[redacted]')
    return text
  },
}))
import LiveReporter from './reporter'

const tempFiles: string[] = []
beforeEach(() => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})
afterEach(() => {
  vi.restoreAllMocks()
  for (const file of tempFiles.splice(0)) unlinkSync(file)
})

function testCase(overrides: Partial<TestCase> = {}): TestCase {
  return { title: 'Synthetic customer journey', expectedStatus: 'passed', annotations: [], ...overrides } as TestCase
}
function testResult(overrides: Partial<TestResult> = {}): TestResult {
  return { status: 'passed', annotations: [], errors: [], stdout: [], stderr: [], steps: [], attachments: [], ...overrides } as unknown as TestResult
}
function testStep(title: string, parent?: TestStep): TestStep {
  return {
    title, parent, titlePath: () => [...(parent?.titlePath() || []), title],
    category: 'pw:api', startTime: new Date(0), duration: -1,
    annotations: [], attachments: [], steps: [],
  }
}
const passedRun = { status: 'passed' } as FullResult

function expectNoSecrets(text: string) {
  for (const value of Object.values(secrets)) expect(text).not.toContain(value)
}

describe('live report privacy and failure status', () => {
  it('redacts nested error causes and secrets split across stdout/stderr writes', async () => {
    const reporter = new LiveReporter()
    const bytes = Buffer.from(secrets.password)
    const error: TestError = {
      message: `Request failed ${secrets.email}`, stack: secrets.apiKey,
      cause: { snippet: secrets.password, cause: { value: secrets.apiKey } },
    }
    const result = testResult({
      status: 'failed', error, errors: [error],
      stdout: [bytes.subarray(0, bytes.length - 1), bytes.subarray(bytes.length - 1), ' ', secrets.apiKey.slice(0, 20), secrets.apiKey.slice(20)],
      stderr: [secrets.email.slice(0, 12), Buffer.from(secrets.email.slice(12))],
    })
    reporter.onTestEnd(testCase(), result)
    expect(result.stdout).toEqual(['[redacted] [redacted]'])
    expect(result.stderr).toEqual(['[redacted]'])
    expectNoSecrets(JSON.stringify(result.errors))
    expectNoSecrets(vi.mocked(process.stdout.write).mock.calls.map(call => String(call[0])).join(''))
    const topLevel: TestError = { message: 'Runner failed', cause: { message: secrets.password } }
    reporter.onError(topLevel)
    expect(topLevel.cause?.message).toBe('[redacted]')
    expect(await reporter.onEnd(passedRun)).toEqual({ status: 'failed' })
  })

  it('sanitizes begin-event titles immediately and unfinished nested steps at run end', async () => {
    const reporter = new LiveReporter()
    const test = testCase()
    const parent = testStep(`Fill ${secrets.email}`)
    const result = testResult({ status: 'interrupted', steps: [parent] })
    reporter.onTestBegin(test, result)
    reporter.onStepBegin(test, result, parent)
    expectNoSecrets(parent.title)
    expectNoSecrets(parent.titlePath().join(' > '))

    // This unfinished child never gets onStepEnd, nor does its test get onTestEnd.
    const child = testStep(`Fill ${secrets.password}`, parent)
    child.error = { message: secrets.apiKey, cause: { value: secrets.password } }
    child.annotations.push({ type: 'note', description: secrets.email })
    parent.steps.push(child)
    await reporter.onEnd(passedRun)
    expectNoSecrets(child.titlePath().join(' > '))
    expectNoSecrets(JSON.stringify({ title: child.title, error: child.error, annotations: child.annotations }))
    expect(child.titlePath()).toEqual(['Fill [redacted]', 'Fill [redacted]'])
  })

  it('redacts textual attachment files and buffers before HTML can copy them', async () => {
    const reporter = new LiveReporter()
    const path = join(tmpdir(), `zvid-live-reporter-${randomUUID()}.log`)
    writeFileSync(path, `${secrets.password}\n${secrets.apiKey}`, { flag: 'wx' })
    tempFiles.push(path)
    const attachment = { name: `Context ${secrets.email}`, path, contentType: 'text/plain' }
    const json = { name: 'diagnostics', contentType: 'application/json', body: Buffer.from(JSON.stringify({ key: secrets.apiKey })) }
    const result = testResult({ attachments: [attachment, json] })
    reporter.onTestEnd(testCase(), result)
    expect(readFileSync(path, 'utf8')).toBe('[redacted]\n[redacted]')
    expectNoSecrets(attachment.name)
    expectNoSecrets(json.body.toString())
    expect(await reporter.onEnd(passedRun)).toEqual({ status: 'passed' })
  })

  it('withholds an unreadable text attachment and fails the report', async () => {
    const reporter = new LiveReporter()
    const result = testResult({ attachments: [{ name: 'missing context', contentType: 'text/plain', path: join(tmpdir(), `missing-${randomUUID()}.md`) }] })
    reporter.onTestEnd(testCase(), result)
    expect(result.attachments[0].path).toBeUndefined()
    expect(result.attachments[0].body?.toString()).toContain('withheld')
    expect(await reporter.onEnd(passedRun)).toEqual({ status: 'failed' })
  })

  it.each(['failed', 'skipped'] as const)('fails a %s customer journey even if the aggregate result says passed', async status => {
    const reporter = new LiveReporter()
    reporter.onTestEnd(testCase(), testResult({ status }))
    expect(await reporter.onEnd(passedRun)).toEqual({ status: 'failed' })
  })
})

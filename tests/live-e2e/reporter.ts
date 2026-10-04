import type { Reporter, TestCase, TestResult, FullResult, TestStep, TestError } from '@playwright/test/reporter'
import { readFileSync, writeFileSync } from 'node:fs'
import { redact } from './helpers/env'

function redactError(error: TestError | undefined, seen = new Set<TestError>()): void {
  if (!error || seen.has(error)) return
  seen.add(error)
  for (const field of ['message', 'stack', 'snippet', 'value'] as const) {
    if (typeof error[field] === 'string') error[field] = redact(error[field])
  }
  redactError(error.cause, seen)
}

function redactOutput(chunks: Array<string | Buffer>): Array<string | Buffer> {
  if (!chunks.length) return []
  // Joining first also catches a credential split across separate stdout writes.
  const joined = Buffer.concat(chunks.map(chunk => typeof chunk === 'string' ? Buffer.from(chunk) : chunk)).toString('utf8')
  return [redact(joined)]
}

export default class LiveReporter implements Reporter {
  private bad = false
  private results = new Map<TestResult, TestCase>()

  onBegin(_config: unknown, suite: { allTests(): TestCase[] }) {
    process.stdout.write(`Live customer journeys: ${suite.allTests().length}; one worker, zero retries.\n`)
  }

  onTestBegin(test: TestCase, result: TestResult) {
    this.results.set(result, test)
  }

  onStepBegin(_test: TestCase, _result: TestResult, step: TestStep) {
    // Sanitize before another reporter can observe a credential-bearing fill title.
    this.redactStep(step)
  }

  onStepEnd(_test: TestCase, _result: TestResult, step: TestStep) {
    this.redactStep(step)
  }

  private redactStep(step: TestStep, seen = new Set<TestStep>()) {
    if (seen.has(step)) return
    seen.add(step)
    step.title = redact(step.title)
    // Playwright's original method closes over the unredacted begin-event title.
    step.titlePath = () => {
      const path: string[] = []
      const parents = new Set<TestStep>()
      for (let current: TestStep | undefined = step; current && !parents.has(current); current = current.parent) {
        parents.add(current)
        path.unshift(redact(current.title))
      }
      return path
    }
    redactError(step.error)
    for (const annotation of step.annotations || []) {
      if (annotation.description) annotation.description = redact(annotation.description)
    }
    for (const attachment of step.attachments || []) this.redactAttachment(attachment)
    for (const child of step.steps) this.redactStep(child, seen)
  }

  private redactAttachment(attachment: TestResult['attachments'][number]) {
    attachment.name = redact(attachment.name)
    const isText = /^text\//i.test(attachment.contentType) || /(?:json|xml)/i.test(attachment.contentType)
    if (attachment.body && isText) attachment.body = Buffer.from(redact(attachment.body.toString('utf8')))
    // Playwright can write ARIA snapshots even when screenshots and traces are off.
    if (attachment.path && (isText || /\.(md|txt|json|log)$/i.test(attachment.path))) {
      try {
        writeFileSync(attachment.path, redact(readFileSync(attachment.path, 'utf8')))
      } catch {
        // Never let HTML copy an attachment whose text could not be sanitized.
        delete attachment.path
        attachment.body = Buffer.from('Text attachment withheld because sanitization could not complete.')
        attachment.contentType = 'text/plain'
        this.bad = true
      }
    }
  }

  private redactResult(test: TestCase, result: TestResult) {
    test.title = redact(test.title)
    for (const annotation of [...test.annotations, ...result.annotations]) {
      if (annotation.description) annotation.description = redact(annotation.description)
    }
    redactError(result.error)
    for (const error of result.errors) redactError(error)
    // Include steps missing onStepEnd after cancellation or worker interruption.
    for (const step of result.steps) this.redactStep(step)
    result.stdout = redactOutput(result.stdout)
    result.stderr = redactOutput(result.stderr)
    for (const attachment of result.attachments) this.redactAttachment(attachment)
  }

  onTestEnd(test: TestCase, result: TestResult) {
    if (result.status !== 'passed' || test.expectedStatus !== 'passed') this.bad = true
    this.results.set(result, test)
    // This reporter precedes HTML, which consumes these objects when the run ends.
    this.redactResult(test, result)
    process.stdout.write(`${result.status}: ${test.title}\n`)
    for (const error of result.errors) process.stdout.write(`${redact(error.stack || error.message || '').slice(0,5000)}\n`)
  }

  onError(error: TestError) {
    this.bad = true
    redactError(error)
    process.stderr.write(`${error.message || 'Live E2E runner failed'}\n`)
  }

  async onEnd(result: FullResult) {
    // A test interrupted before onTestEnd can still appear in the HTML report.
    for (const [testResult, test] of this.results) {
      if (testResult.status !== 'passed' || test.expectedStatus !== 'passed') this.bad = true
      this.redactResult(test, testResult)
    }
    return { status: this.bad ? 'failed' as const : result.status }
  }
}

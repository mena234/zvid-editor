import { randomUUID } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export type ResourceKind = 'project' | 'template' | 'design' | 'upload' | 'apiKey' | 'job'
export interface TrackedResource {
  kind: ResourceKind
  id: string
  name: string
  accountId: string
  createdAt: string
  cleanedAt?: string
  cleanupError?: string
}
export interface Reservation {
  id: string
  kind: 'video' | 'image'
  name: string
  payloadHash: string
  cost: number
  status: 'reserved' | 'acknowledged' | 'settled'
  jobId?: string
  charged?: number
}
export interface RunSnapshot {
  schemaVersion: 1
  runId: string
  prefix: string
  accountId?: string
  cap: number
  /** Original reservations are never released, including after a refund. */
  spentCeiling: number
  stoppedReason?: string
  resources: TrackedResource[]
  reservations: Reservation[]
}

const resourceKinds: ResourceKind[] = ['project', 'template', 'design', 'upload', 'apiKey', 'job']
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

/** Exact manifest entry + current ownership, never a prefix-only deletion. */
export function assertCleanupTarget(
  resource: TrackedResource,
  fetched: { id: string | number; name: string; userId?: string | number },
  accountId: string,
  prefix: string,
): void {
  if (!nonempty(accountId) || !/^pw-live-[a-zA-Z0-9-]+-$/.test(prefix)) throw new Error('Invalid cleanup identity')
  if (!resourceKinds.includes(resource.kind) || !nonempty(resource.id)) throw new Error('Invalid manifest resource')
  if (resource.accountId !== accountId) throw new Error('Cleanup account mismatch')
  if (String(fetched.id) !== resource.id) throw new Error('Cleanup exact ID mismatch')
  if (!resource.name.startsWith(prefix) || resource.name.length <= prefix.length || fetched.name !== resource.name) {
    throw new Error('Cleanup exact name or run prefix mismatch')
  }
  if (fetched.userId !== undefined && String(fetched.userId) !== accountId) throw new Error('Cleanup fetched owner mismatch')
  if (resource.cleanedAt) throw new Error('Resource was already cleaned')
}

/** Synchronous persistence occurs before the caller may send a mutation. */
export class RunState {
  readonly runDir: string
  readonly file: string
  private state!: RunSnapshot

  constructor(runDir: string, cap: number) {
    if (!Number.isInteger(cap) || cap < 1 || cap > 20) throw new Error('Live credit cap must be an integer from 1 to 20')
    this.runDir = resolve(runDir)
    this.file = join(this.runDir, 'run-state.json')
    mkdirSync(this.runDir, { recursive: true })
    this.locked(() => {
      if (existsSync(this.file)) {
        this.read()
        if (this.state.cap !== cap) throw new Error('Cannot change the cap of an existing run')
      } else {
        const runId = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
        this.state = { schemaVersion: 1, runId, prefix: `pw-live-${runId}-`, cap, spentCeiling: 0, resources: [], reservations: [] }
        this.persist()
      }
    })
  }

  get prefix(): string { return this.state.prefix }

  private read(): void {
    const value = JSON.parse(readFileSync(this.file, 'utf8')) as RunSnapshot
    if (value.schemaVersion !== 1 || !nonempty(value.runId) || value.prefix !== `pw-live-${value.runId}-`
      || !Number.isInteger(value.cap) || value.cap < 1 || value.cap > 20
      || !Array.isArray(value.resources) || !Array.isArray(value.reservations)) throw new Error('Invalid run-state manifest')
    const spent = value.reservations.reduce((sum, r) => {
      if (!Number.isInteger(r.cost) || r.cost < 1 || !['video', 'image'].includes(r.kind)
        || !['reserved', 'acknowledged', 'settled'].includes(r.status)
        || !nonempty(r.id) || !r.name?.startsWith(value.prefix) || !/^[a-f0-9]{64}$/.test(r.payloadHash)) {
        throw new Error('Invalid persisted reservation')
      }
      return sum + r.cost
    }, 0)
    if (spent !== value.spentCeiling || spent > value.cap
      || new Set(value.reservations.map(r => r.kind)).size !== value.reservations.length
      || new Set(value.reservations.map(r => r.id)).size !== value.reservations.length
      || value.reservations.some(r => r.kind === 'image' && r.cost !== 1)) throw new Error('Invalid persisted credit budget')
    if (value.resources.some(r => !resourceKinds.includes(r.kind) || !nonempty(r.id)
      || r.accountId !== value.accountId || !r.name?.startsWith(value.prefix))) throw new Error('Invalid persisted resource ownership')
    this.state = value
  }

  private persist(): void {
    const temp = `${this.file}.${randomUUID()}.tmp`
    try {
      writeFileSync(temp, `${JSON.stringify(this.state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
      renameSync(temp, this.file)
    } finally {
      if (existsSync(temp)) unlinkSync(temp)
    }
  }

  private locked<T>(fn: () => T): T {
    const lock = join(this.runDir, '.run-state.lock')
    let fd: number
    try { fd = openSync(lock, 'wx', 0o600) } catch { throw new Error('Run-state is locked; concurrent or interrupted writes require inspection') }
    try { return fn() } finally { closeSync(fd); unlinkSync(lock) }
  }

  private mutate<T>(fn: () => T): T {
    return this.locked(() => {
      this.read()
      const result = fn()
      this.persist()
      return result
    })
  }

  private name(name: string): void {
    if (!nonempty(name) || !name.startsWith(this.prefix) || name.length <= this.prefix.length) throw new Error('Resource name must contain this run prefix and a suffix')
  }

  bindAccount(id: string): void {
    this.mutate(() => {
      if (!nonempty(id)) throw new Error('Account ID is required')
      if (this.state.accountId && this.state.accountId !== id) throw new Error('Run account mismatch')
      this.state.accountId = id
    })
  }

  track(kind: ResourceKind, id: string, name: string): void {
    this.mutate(() => this.addResource(kind, id, name))
  }

  /** Record a confirmed UI/API rename of an already registered exact ID. */
  rename(kind: ResourceKind, id: string, newName: string): void {
    this.mutate(() => {
      this.name(newName)
      const r = this.state.resources.find(item => item.kind === kind && item.id === id)
      if (!r || r.accountId !== this.state.accountId || r.cleanedAt) throw new Error('Cannot rename an unregistered or cleaned resource')
      r.name = newName
    })
  }

  private addResource(kind: ResourceKind, id: string, name: string): void {
    if (!this.state.accountId) throw new Error('Bind an account before tracking resources')
    if (!resourceKinds.includes(kind) || !nonempty(id)) throw new Error('Resource kind and exact ID are required')
    this.name(name)
    const existing = this.state.resources.find(r => r.kind === kind && r.id === id)
    if (existing) {
      if (existing.name !== name || existing.accountId !== this.state.accountId) throw new Error('Resource identity mismatch')
      return
    }
    this.state.resources.push({ kind, id, name, accountId: this.state.accountId, createdAt: new Date().toISOString() })
  }

  reserve(cost: number, input: { kind: 'video' | 'image'; name: string; payloadHash: string }): string {
    return this.mutate(() => {
      if (this.state.stoppedReason) throw new Error(`Run stopped: ${this.state.stoppedReason}`)
      if (!this.state.accountId) throw new Error('Bind an account before reserving credits')
      this.name(input.name)
      if (!['video', 'image'].includes(input.kind) || !/^[a-f0-9]{64}$/.test(input.payloadHash)) throw new Error('A render kind and SHA-256 payload hash are required')
      if (!Number.isInteger(cost) || cost < 1 || (input.kind === 'image' && cost !== 1)) throw new Error('Invalid render credit reservation')
      if (this.state.reservations.some(r => r.status !== 'settled')) {
        this.state.stoppedReason = 'A previous render charge is unknown; its reservation remains counted'
        this.persist()
        throw new Error(this.state.stoppedReason)
      }
      if (this.state.reservations.some(r => r.kind === input.kind)) throw new Error(`Only one ${input.kind} submission is allowed per run`)
      const imageAllowance = input.kind === 'video' && !this.state.reservations.some(r => r.kind === 'image') ? 1 : 0
      if (this.state.spentCeiling + cost + imageAllowance > this.state.cap) throw new Error('Render exceeds the run credit cap, including one image credit')
      const id = randomUUID()
      this.state.reservations.push({ id, ...input, cost, status: 'reserved' })
      this.state.spentCeiling += cost
      return id
    })
  }

  acknowledge(reservationId: string, jobId: string): void {
    this.mutate(() => {
      const r = this.reservation(reservationId)
      if (!nonempty(jobId)) throw new Error('Acknowledged job ID is required')
      if (r.jobId && r.jobId !== jobId) throw new Error('Reservation job ID mismatch')
      if (r.status === 'settled') throw new Error('Cannot acknowledge a settled reservation')
      if (this.state.reservations.some(other => other.id !== r.id && other.jobId === jobId)) throw new Error('Job ID was already acknowledged')
      r.jobId = jobId
      r.status = 'acknowledged'
      this.addResource('job', jobId, r.name)
    })
  }

  settle(reservationId: string, charged: number): void {
    this.mutate(() => {
      const r = this.reservation(reservationId)
      if (!Number.isFinite(charged) || charged < 0 || !Number.isInteger(charged)) throw new Error('Settled credits must be a non-negative integer')
      if (r.status !== 'acknowledged') throw new Error('Only an acknowledged job may settle')
      r.charged = charged
      r.status = 'settled'
      if (charged > r.cost) {
        this.state.stoppedReason = 'Actual charge exceeded the reserved credit estimate'
        this.persist()
        throw new Error(this.state.stoppedReason)
      }
    })
  }

  private reservation(id: string): Reservation {
    const found = this.state.reservations.find(r => r.id === id)
    if (!found) throw new Error('Unknown reservation ID')
    return found
  }

  stop(reason: string): void {
    this.mutate(() => {
      if (!nonempty(reason)) throw new Error('A stop reason is required')
      this.state.stoppedReason ||= reason
    })
  }

  snapshot(): RunSnapshot { this.read(); return clone(this.state) }
  eligibleResources(): TrackedResource[] { return this.snapshot().resources.filter(r => !r.cleanedAt) }

  markCleaned(kind: ResourceKind, id: string): void {
    this.mutate(() => {
      const r = this.state.resources.find(item => item.kind === kind && item.id === id)
      if (!r) throw new Error('Cannot clean an unregistered exact ID')
      r.cleanedAt = new Date().toISOString()
      delete r.cleanupError
    })
  }

  markCleanupFailure(kind: ResourceKind, id: string, error: string): void {
    this.mutate(() => {
      const r = this.state.resources.find(item => item.kind === kind && item.id === id)
      if (!r) throw new Error('Cannot record cleanup for an unregistered exact ID')
      r.cleanupError = error.slice(0, 1000)
    })
  }
}

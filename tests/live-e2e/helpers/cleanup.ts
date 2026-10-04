import { LiveApi } from './api'
import { RunState, assertCleanupTarget, type TrackedResource } from './run-state'

const endpoints = { project: 'projects', template: 'templates', upload: 'uploads', apiKey: 'api-keys', job: 'jobs', design: 'designs' } as const

async function currentResource(api: LiveApi, resource: TrackedResource) {
  if (resource.kind === 'design') throw new Error('Design cleanup is outside this live suite; retained for inspection')
  if (resource.kind === 'upload' || resource.kind === 'apiKey') {
    const body = await api.get(`/${endpoints[resource.kind]}`)
    const list = resource.kind === 'upload' ? body.uploads : body.apiKeys
    if (!Array.isArray(list)) throw new Error('Cleanup list response was invalid')
    const item = list.find((entry: any) => String(entry.id) === resource.id)
    if (resource.kind === 'apiKey' && item && (item.is_active === 0 || item.isActive === false)) return null
    return item ? { ...item, id: String(item.id), name: item.name ?? item.fileName ?? item.file_name, userId: item.userId ?? item.user_id } : null
  }
  if (resource.kind === 'job') {
    const statusResponse = await api.request(`/jobs/${encodeURIComponent(resource.id)}`)
    if (statusResponse.status() === 404) return null
    if (!statusResponse.ok()) throw new Error(`Cleanup status failed (${statusResponse.status()})`)
    const status = await statusResponse.json()
    if (!['completed', 'failed'].includes(status.state)) throw new Error(`Unfinished job retained: ${resource.id}`)
    const list = await api.get(`/jobs?q=${encodeURIComponent(resource.name)}&limit=100`)
    const item = list.jobs?.find((entry: any) => String(entry.id) === resource.id)
    if (!item) throw new Error('Terminal job was not found with its exact recorded name; retained')
    return { ...item, id: String(item.id) }
  }
  const response = await api.request(`/${endpoints[resource.kind]}/${encodeURIComponent(resource.id)}`)
  if (response.status() === 404) return null
  if (!response.ok()) throw new Error(`Cleanup inspection failed (${response.status()})`)
  const body = await response.json()
  const item = body[resource.kind] || body
  // Archived templates no longer occupy the active customer library.
  if (resource.kind === 'template' && item.status === 'archived') return null
  return { ...item, id: String(item.id), userId: item.userId ?? item.user_id }
}

/** Only exact receipts in this manifest can ever reach a DELETE request. */
export async function cleanupResources(api: LiveApi, run: RunState, resources = run.eligibleResources()) {
  const recorded = run.eligibleResources()
  for (const resource of resources) {
    if (!recorded.some(item => item.kind === resource.kind && item.id === resource.id && item.name === resource.name && item.accountId === resource.accountId))
      throw new Error('Cleanup target is outside the exact active run manifest')
  }
  const snapshot = run.snapshot()
  const accountId = snapshot.accountId
  if (!accountId) return []
  const profile = await api.get('/user/profile')
  if (String(profile.user?.id) !== accountId) throw new Error('Cleanup account differs from the manifest owner')
  // A lost acknowledgement can leave a real render running without a tracked job.
  // Keep its inputs even when this cleanup invocation has no job receipt to inspect.
  const unacknowledged = snapshot.reservations.filter(reservation => !reservation.jobId)
  const unsettled = snapshot.reservations.filter(reservation => reservation.jobId && reservation.status !== 'settled')
  const failures: string[] = unacknowledged.map(reservation =>
    `reservation ${reservation.id}: Render acknowledgement is unknown; source resources retained for inspection`)
  failures.push(...unsettled.map(reservation =>
    `reservation ${reservation.id}: Final render charge is unknown; job ${reservation.jobId} and source resources retained for reconciliation`))
  let retainMedia = unacknowledged.length > 0 || unsettled.length > 0
  if (unacknowledged.length) run.stop('Cleanup retained source resources because a render acknowledgement is unknown')
  else if (unsettled.length) run.stop('Cleanup retained jobs and source resources because a final render charge is unknown')
  // Jobs/templates/projects first; uploaded media may still be referenced by them.
  const order = ['job', 'template', 'project', 'design', 'apiKey', 'upload']
  for (const resource of [...resources].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))) {
    try {
      if (retainMedia && resource.kind !== 'job' && resource.kind !== 'apiKey') throw new Error('Retained because an unfinished or uninspectable job may still reference this resource')
      const item = await currentResource(api, resource)
      // A completed/failed job is still the source of recorded-charge evidence.
      // Do not erase it merely because rendering ended before accounting did.
      if (resource.kind === 'job' && unsettled.some(reservation => reservation.jobId === resource.id))
        throw new Error('Final render charge is unknown; job retained until its reservation is reconciled and settled')
      if (item) {
        assertCleanupTarget(resource, item, accountId, run.prefix)
        const response = await api.request(`/${endpoints[resource.kind]}/${encodeURIComponent(resource.id)}`, { method: 'DELETE' })
        if (!response.ok() && response.status() !== 404) throw new Error(`Delete rejected (${response.status()})`)
      }
      run.markCleaned(resource.kind, resource.id)
    } catch (error) {
      if (resource.kind === 'job') retainMedia = true
      const message = error instanceof Error ? error.message : 'Cleanup failed'
      run.markCleanupFailure(resource.kind, resource.id, message)
      failures.push(`${resource.kind} ${resource.id}: ${message}`)
    }
  }
  return failures
}

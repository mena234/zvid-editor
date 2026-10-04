export interface OutputAvailability {
  outputExpiresAt?: string | null
  outputExpiredAt?: string | null
  outputCleanupStatus?: string | null
}

function deadlineTime(value: string): number {
  // Persisted database timestamps are UTC even when they omit an offset.
  const timestamp = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value
  return Date.parse(timestamp)
}

export function isOutputExpired(job: OutputAvailability, now = Date.now()): boolean {
  if (job.outputExpiredAt) return true
  if (!job.outputExpiresAt) return false
  const deadline = deadlineTime(job.outputExpiresAt)
  return Number.isFinite(deadline) && deadline <= now
}

export function outputAvailabilityLabel(job: OutputAvailability, now = Date.now()): string {
  if (isOutputExpired(job, now)) return 'Output expired'
  if (!job.outputExpiresAt) return ''
  const deadline = new Date(deadlineTime(job.outputExpiresAt))
  if (!Number.isFinite(deadline.getTime())) return ''
  return `Available until ${deadline.toLocaleString()}`
}

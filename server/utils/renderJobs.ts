import { randomUUID } from 'node:crypto'

export interface RenderJob {
  id: string
  status: 'queued' | 'running' | 'done' | 'error'
  progress: number
  error?: string
  filePath?: string
  fileName?: string
  createdAt: number
}

const jobs = new Map<string, RenderJob>()
let running = false
const queue: (() => Promise<void>)[] = []

export function createJob(): RenderJob {
  const job: RenderJob = {
    id: randomUUID(),
    status: 'queued',
    progress: 0,
    createdAt: Date.now(),
  }
  jobs.set(job.id, job)
  // GC old jobs
  for (const [id, j] of jobs) {
    if (Date.now() - j.createdAt > 1000 * 60 * 60) jobs.delete(id)
  }
  return job
}

export function getJob(id: string): RenderJob | undefined {
  return jobs.get(id)
}

/** one-at-a-time render queue */
export function enqueue(task: () => Promise<void>) {
  queue.push(task)
  pump()
}

async function pump() {
  if (running) return
  const task = queue.shift()
  if (!task) return
  running = true
  try {
    await task()
  } finally {
    running = false
    pump()
  }
}

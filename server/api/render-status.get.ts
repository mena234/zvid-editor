import { getJob } from '../utils/renderJobs'

export default defineEventHandler((event) => {
  const id = getQuery(event).id as string
  const job = id ? getJob(id) : undefined
  if (!job) throw createError({ statusCode: 404, statusMessage: 'Unknown render job' })
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    error: job.error,
    fileName: job.fileName,
  }
})

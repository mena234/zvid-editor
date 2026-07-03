import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname } from 'node:path'
import { getJob } from '../utils/renderJobs'

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.ogv': 'video/ogg',
}

export default defineEventHandler((event) => {
  const id = getQuery(event).id as string
  const job = id ? getJob(id) : undefined
  if (!job || job.status !== 'done' || !job.filePath || !existsSync(job.filePath)) {
    throw createError({ statusCode: 404, statusMessage: 'Rendered file not found' })
  }
  const stat = statSync(job.filePath)
  setHeader(
    event,
    'Content-Type',
    MIME[extname(job.filePath).toLowerCase()] ?? 'application/octet-stream'
  )
  setHeader(event, 'Content-Length', stat.size)
  setHeader(
    event,
    'Content-Disposition',
    `inline; filename="${job.fileName ?? 'render.mp4'}"`
  )
  return sendStream(event, createReadStream(job.filePath))
})

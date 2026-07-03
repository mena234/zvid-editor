import { createRequire } from 'node:module'
import { resolve, join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { createJob, enqueue } from '../utils/renderJobs'

/**
 * Feature-flagged real render (M12): wraps the local @zvid-io/zvid build.
 * Requires FFmpeg on PATH and the package's node_modules installed
 * (Puppeteer, sharp…). Renders queue one at a time.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  if (!config.renderEnabled) {
    throw createError({ statusCode: 403, statusMessage: 'Rendering is disabled (NUXT_RENDER_ENABLED=false)' })
  }

  const body = await readBody(event)
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Expected a project JSON body' })
  }

  let renderVideo: any
  try {
    const require = createRequire(import.meta.url)
    const pkgPath = resolve(process.cwd(), config.zvidPackagePath)
    renderVideo = require(pkgPath)
    renderVideo = renderVideo?.default ?? renderVideo
  } catch (e: any) {
    throw createError({
      statusCode: 500,
      statusMessage: `Could not load the zvid package from "${config.zvidPackagePath}": ${e.message}`,
    })
  }

  const job = createJob()
  const outDir = join(process.cwd(), '.render-output', job.id)
  await mkdir(outDir, { recursive: true })

  enqueue(async () => {
    job.status = 'running'
    try {
      const result = await renderVideo(body, outDir, (p: number) => {
        job.progress = p
      })
      job.progress = 100
      job.filePath = result.localPath
      job.fileName = result.fileName
      job.status = 'done'
    } catch (e: any) {
      job.status = 'error'
      job.error = e?.message ?? String(e)
    }
  })

  return { jobId: job.id }
})

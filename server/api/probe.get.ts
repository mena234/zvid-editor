import { execFile } from 'node:child_process'

/**
 * ffprobe fallback for media the browser can't inspect (CORS-blocked URLs).
 * Returns { width, height, duration, hasAudio } like the package's
 * getVideoMetaData. Requires ffprobe on PATH (ships with FFmpeg).
 */
export default defineEventHandler(async (event) => {
  const src = getQuery(event).src as string
  if (!src || !/^https?:\/\//i.test(src)) {
    throw createError({ statusCode: 400, statusMessage: 'src must be an http(s) URL' })
  }

  const json = await new Promise<string>((resolve, reject) => {
    execFile(
      'ffprobe',
      [
        '-v', 'error',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        src,
      ],
      { timeout: 20000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve(stdout))
    )
  }).catch((e) => {
    throw createError({ statusCode: 502, statusMessage: `ffprobe failed: ${e.message}` })
  })

  const meta = JSON.parse(json)
  const video = meta.streams?.find(
    (s: any) => s.codec_type === 'video' || s.codec_type === 'image'
  )
  const audio = meta.streams?.find((s: any) => s.codec_type === 'audio')
  return {
    width: video?.width,
    height: video?.height,
    duration: meta.format?.duration ? Number(meta.format.duration) : undefined,
    hasAudio: !!audio,
  }
})

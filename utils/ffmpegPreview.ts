import { FFmpeg } from '@ffmpeg/ffmpeg'
import coreSource from '@ffmpeg/core?raw'
import wasmURL from '@ffmpeg/core/wasm?url'
import { reentrantFfmpegCore } from './ffmpegCoreSource'
import { mediaFilterArgs, type MediaFilter } from './ffmpegFilterGraph'

// One lazy engine for the stage. Commands and its in-memory files are serialized;
// callers supply a freshness check so obsolete slider/seek work never piles up.
let engine: FFmpeg | undefined
let loading: Promise<FFmpeg> | undefined
let queue: Promise<unknown> = Promise.resolve()
let users = 0
let idleTimer: ReturnType<typeof setTimeout> | undefined

export function retainFilterEngine() {
  clearTimeout(idleTimer)
  users++
  let released = false
  return () => {
    if (released) return
    released = true
    if (--users === 0)
      idleTimer = setTimeout(() => {
        engine?.terminate()
        engine = undefined
        loading = undefined
      }, 30_000)
  }
}

async function getEngine() {
  if (!loading) {
    const instance = new FFmpeg()
    engine = instance
    loading = (async () => {
      const timer = setTimeout(() => instance.terminate(), 45_000)
      let coreURL: string | undefined
      try {
        coreURL = URL.createObjectURL(
          new Blob([reentrantFfmpegCore(coreSource)], {
            type: 'text/javascript',
          })
        )
        await instance.load({
          coreURL,
          wasmURL: new URL(wasmURL, window.location.href).href,
        })
        return instance
      } catch (error) {
        instance.terminate()
        if (engine === instance) {
          loading = undefined
          engine = undefined
        }
        throw error
      } finally {
        clearTimeout(timer)
        if (coreURL) URL.revokeObjectURL(coreURL)
      }
    })()
  }
  return loading
}

export function filterRgba(
  data: Uint8Array,
  width: number,
  height: number,
  filter: MediaFilter,
  current: () => boolean = () => true
): Promise<Uint8ClampedArray | null> {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > 4096 * 4096 ||
    data.length !== width * height * 4
  )
    return Promise.reject(new Error('Invalid filter frame dimensions'))
  const run = queue
    .catch(() => {})
    .then(async () => {
      if (!current()) return null
      const ffmpeg = await getEngine()
      if (!current()) return null
      try {
        await ffmpeg.writeFile('input.rgba', data)
        const status = await ffmpeg.exec(mediaFilterArgs(filter, width, height), 10_000)
        if (status !== 0) throw new Error('Could not prepare the filtered frame')
        const result = await ffmpeg.readFile('output.rgba')
        if (!(result instanceof Uint8Array) || result.length !== width * height * 4)
          throw new Error('Incomplete filtered frame')
        return current() ? new Uint8ClampedArray(result) : null
      } catch (error) {
        // A trapped WASM instance cannot safely be reused by another stage item.
        ffmpeg.terminate()
        if (engine === ffmpeg) {
          engine = undefined
          loading = undefined
        }
        throw error
      } finally {
        await ffmpeg.deleteFile('input.rgba').catch(() => {})
        await ffmpeg.deleteFile('output.rgba').catch(() => {})
      }
    })
  queue = run
  return run
}

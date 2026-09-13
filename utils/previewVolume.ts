import { clamp } from './time'

interface VolumeRoute {
  source: MediaElementAudioSourceNode
  gain: GainNode
}

// One context mixes all stage videos and timeline audio. A media element can
// only be attached to one source node, so retain its route until it is removed.
let context: AudioContext | undefined
const routes = new Map<HTMLMediaElement, VolumeRoute>()

export function supportsAmplifiedVolume() {
  return typeof globalThis.AudioContext === 'function'
}

/** Call with a CORS-readable source when gain can exceed 1. */
export function setPreviewVolume(
  media: HTMLMediaElement,
  value: number,
  muted: boolean,
  playing: boolean
) {
  const volume = clamp(Number.isFinite(value) ? value : 1, 0, 2)
  let route = routes.get(media)
  if (!route && volume > 1 && supportsAmplifiedVolume()) {
    try {
      context ??= new AudioContext()
      const gain = context.createGain()
      const source = context.createMediaElementSource(media)
      source.connect(gain)
      gain.connect(context.destination)
      route = { source, gain }
      routes.set(media, route)
    } catch {
      // Native playback remains available when Web Audio is unavailable.
    }
  }
  media.volume = route ? 1 : Math.min(volume, 1)
  media.muted = muted || volume === 0
  if (route) {
    route.gain.gain.value = volume
    if (playing && context?.state === 'suspended') {
      void context.resume().catch(() => {})
    }
  }
}

export function releasePreviewVolume(media: HTMLMediaElement) {
  const route = routes.get(media)
  if (!route) return
  route.source.disconnect()
  route.gain.disconnect()
  routes.delete(media)
  if (!routes.size && context) {
    void context.close().catch(() => {})
    context = undefined
  }
}

/** Rasterize the media's item box before color filtering, in project pixels. */
export function drawFilterFrame(
  context: CanvasRenderingContext2D,
  source: HTMLImageElement | HTMLVideoElement,
  width: number,
  height: number,
  fit?: string,
  crop?: { x: number; y: number; width: number; height: number } | null,
  radius?: { tl?: number; tr?: number; br?: number; bl?: number } | null
) {
  const sw = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth
  const sh =
    source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight
  if (!sw || !sh) throw new Error('Media has no decoded frame')
  context.clearRect(0, 0, width, height)
  context.save()
  if (radius) {
    context.beginPath()
    context.roundRect(
      0,
      0,
      width,
      height,
      [radius.tl ?? 0, radius.tr ?? 0, radius.br ?? 0, radius.bl ?? 0].map((v) =>
        Math.max(0, v)
      )
    )
    context.clip()
  }
  if (crop && crop.width > 0 && crop.height > 0) {
    context.drawImage(
      source,
      (-crop.x * width) / crop.width,
      (-crop.y * height) / crop.height,
      (sw * width) / crop.width,
      (sh * height) / crop.height
    )
  } else if (fit === 'contain' || fit === 'cover') {
    const scale = (fit === 'contain' ? Math.min : Math.max)(width / sw, height / sh)
    context.drawImage(
      source,
      (width - sw * scale) / 2,
      (height - sh * scale) / 2,
      sw * scale,
      sh * scale
    )
  } else context.drawImage(source, 0, 0, width, height)
  context.restore()
}

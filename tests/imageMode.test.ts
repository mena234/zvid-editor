import { describe, it, expect } from 'vitest'
import {
  importProject,
  exportProject,
  newProjectDoc,
} from '../shared/schema/normalize'
import { validateProjectDoc } from '../shared/schema/validate'

/** Image-mode contract (IMAGE_RENDERING_PLAN §4): type/snapshotTime/quality/
 *  transparent round-trip, video exports stay untouched, and the validator
 *  mirrors orch's image branch. */

const imageRaw = {
  type: 'image',
  name: 'promo-card',
  resolution: 'instagram-post',
  backgroundColor: '#ffffff',
  outputFormat: 'webp',
  snapshotTime: 1.5,
  quality: 80,
  transparent: true,
  visuals: [
    { type: 'TEXT', text: 'Hello', x: 100, y: 100 },
    { type: 'IMAGE', src: 'https://cdn.zvid.io/x.png', width: 300, height: 300 },
  ],
}

describe('image project round-trip', () => {
  it('keeps type + image knobs through import/export', () => {
    const { doc, warnings } = importProject(imageRaw)
    expect(warnings).toEqual([])
    expect(doc.type).toBe('image')
    expect(doc.snapshotTime).toBe(1.5)
    expect(doc.quality).toBe(80)
    expect(doc.transparent).toBe(true)

    const out = exportProject(doc)
    expect(out.type).toBe('image')
    expect(out.snapshotTime).toBe(1.5)
    expect(out.quality).toBe(80)
    expect(out.transparent).toBe(true)
    expect(out.duration).toBeUndefined()
    expect(out.frameRate).toBeUndefined()
    expect(out.audios).toBeUndefined()
  })

  it('infers image mode from an image-only outputFormat when type is omitted', () => {
    // JSONs written for the /api/render/image alias omit type — the alias
    // injects it server-side. The editor must not open them as broken videos.
    const { doc, warnings } = importProject({
      name: 'alias-style',
      outputFormat: 'png',
      visuals: [{ type: 'TEXT', text: 'x' }],
    })
    expect(doc.type).toBe('image')
    expect(warnings.some((w) => w.includes('image project'))).toBe(true)
    expect(validateProjectDoc(doc).filter((i) => i.level === 'error')).toEqual([])
  })

  it('does NOT infer image mode when time-domain content exists', () => {
    const { doc } = importProject({
      name: 'video-with-bad-format',
      outputFormat: 'png',
      duration: 10,
      visuals: [],
    })
    expect(doc.type).toBeUndefined()
    // stays a video; the format error is the actionable signal
    expect(
      validateProjectDoc(doc).some(
        (i) => i.level === 'error' && i.path === 'outputFormat'
      )
    ).toBe(true)
  })

  it('video exports never gain a type key (wire default stays implicit)', () => {
    const out = exportProject(newProjectDoc('video'))
    expect('type' in out).toBe(false)
    expect('snapshotTime' in out).toBe(false)
    expect('quality' in out).toBe(false)
    expect('transparent' in out).toBe(false)
  })

  it('new image project has no time-domain fields and validates clean', () => {
    const doc = newProjectDoc('image')
    expect(doc.type).toBe('image')
    expect(doc.duration).toBeUndefined()
    expect(doc.frameRate).toBeUndefined()
    expect(doc.outputFormat).toBe('png')
    expect(validateProjectDoc(doc).filter((i) => i.level === 'error')).toEqual([])
  })
})

describe('image project validation (mirrors orch branch)', () => {
  const base = () => ({ ...newProjectDoc('image') })

  const errorsOf = (doc: any) =>
    validateProjectDoc(doc)
      .filter((i) => i.level === 'error')
      .map((i) => i.path)

  it('rejects time-domain root fields', () => {
    const doc = {
      ...base(),
      duration: 10,
      frameRate: 30,
      thumbnail: 'https://x/y.png',
    }
    const paths = errorsOf(doc)
    expect(paths).toContain('duration')
    expect(paths).toContain('frameRate')
    expect(paths).toContain('thumbnail')
  })

  it('rejects audios / scenes / subtitle', () => {
    const doc = {
      ...base(),
      audios: [{ src: 'https://x/a.mp3', _id: 'a1' }],
      scenes: [{ _id: 's1', id: 'scene-0', visuals: [], audios: [] }],
      subtitle: { captions: [{ start: 0, end: 1, text: 'x', words: [] }] },
    }
    const paths = errorsOf(doc as any)
    expect(paths).toContain('audios')
    expect(paths).toContain('scenes')
    expect(paths).toContain('subtitle')
  })

  it('rejects VIDEO/GIF elements and per-item timing fields', () => {
    const doc = base()
    doc.visuals = [
      { type: 'VIDEO', src: 'https://x/v.mp4', _id: 'v1' } as any,
      { type: 'GIF', src: 'https://x/g.gif', _id: 'v2' } as any,
      { type: 'TEXT', text: 'x', enterBegin: 1, exitEnd: 4, _id: 'v3' } as any,
    ]
    const paths = errorsOf(doc)
    expect(paths).toContain('visuals[0]')
    expect(paths).toContain('visuals[1]')
    expect(paths).toContain('visuals[2].enterBegin')
    expect(paths).toContain('visuals[2].exitEnd')
  })

  it('rejects jpg+transparent and png+quality', () => {
    expect(errorsOf({ ...base(), outputFormat: 'jpg', transparent: true })).toContain(
      'transparent'
    )
    expect(errorsOf({ ...base(), outputFormat: 'png', quality: 90 })).toContain(
      'quality'
    )
    // valid pairings stay clean
    expect(errorsOf({ ...base(), outputFormat: 'webp', quality: 80, transparent: true })).toEqual(
      []
    )
  })

  it('rejects video output formats for image projects and vice versa', () => {
    expect(errorsOf({ ...base(), outputFormat: 'mp4' })).toContain('outputFormat')
    expect(errorsOf({ ...newProjectDoc('video'), outputFormat: 'png' })).toContain(
      'outputFormat'
    )
  })

  it('rejects image knobs on video projects', () => {
    const paths = errorsOf({ ...newProjectDoc('video'), snapshotTime: 1, quality: 80 })
    expect(paths).toContain('snapshotTime')
    expect(paths).toContain('quality')
  })
})

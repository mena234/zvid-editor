import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useProjectStore } from '../../stores/project'
import { useTemplateVars } from '../../composables/useTemplateVars'

/**
 * Pure decision logic of useTemplateVars: validateTemplateValue (typed-field
 * strict validation) and placeholderOptions. Scenes are passed straight to
 * the functions — only the variable defaults live in the store
 * (doc.extra.variables).
 */

function setup(vars: Record<string, unknown> = {}) {
  const project = useProjectStore()
  project.doc.extra = { variables: vars }
  return useTemplateVars()
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('validateTemplateValue', () => {
  it('accepts placeholder-free text for every kind (parsing is the caller’s job)', () => {
    const tv = setup({})
    expect(tv.validateTemplateValue('hello', 'string')).toEqual({ ok: true })
    // NOTE: documented behavior — plain text passes even for numeric fields;
    // only placeholder syntax/typing is validated here
    expect(tv.validateTemplateValue('hello', 'number')).toEqual({ ok: true })
    expect(tv.validateTemplateValue('', 'any')).toEqual({ ok: true })
  })

  it('rejects unsupported expressions', () => {
    const tv = setup({ n: 1 })
    const r = tv.validateTemplateValue('{{n + 1}}', 'any')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('Unsupported expression')
  })

  it('rejects undefined variables with a pointer to the Variables panel', () => {
    const tv = setup({ n: 1 })
    const r = tv.validateTemplateValue('{{ghost}}', 'any')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('is not defined')
  })

  it('rejects when ANY placeholder of a mixed string is undefined', () => {
    const tv = setup({ a: 'x' })
    expect(tv.validateTemplateValue('{{a}} {{b}}', 'any').ok).toBe(false)
  })

  it('number kind: whole-string number placeholder is ok', () => {
    const tv = setup({ count: 3 })
    expect(tv.validateTemplateValue('{{count}}', 'number')).toEqual({ ok: true })
  })

  it('number kind: surrounding whitespace still counts as whole-string', () => {
    const tv = setup({ count: 3 })
    expect(tv.validateTemplateValue('  {{count}}  ', 'number')).toEqual({ ok: true })
  })

  it('number kind: rejects text around the placeholder', () => {
    const tv = setup({ count: 3 })
    const r = tv.validateTemplateValue('{{count}}px', 'number')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('single {{variable}}')
  })

  it('number kind: rejects two placeholders (not a single whole match)', () => {
    const tv = setup({ a: 1, b: 2 })
    expect(tv.validateTemplateValue('{{a}}{{b}}', 'number').ok).toBe(false)
  })

  it('number kind: rejects non-number variables, naming the actual type', () => {
    const tv = setup({ name: 'x', flag: true, list: [1] })
    const r1 = tv.validateTemplateValue('{{name}}', 'number')
    expect(r1.ok).toBe(false)
    if (!r1.ok) expect(r1.message).toContain('is string')
    const r2 = tv.validateTemplateValue('{{flag}}', 'number')
    if (!r2.ok) expect(r2.message).toContain('is boolean')
    const r3 = tv.validateTemplateValue('{{list}}', 'number')
    if (!r3.ok) expect(r3.message).toContain('is array')
  })

  it('string kind (colors, srcs, …): whole-string must resolve to a string', () => {
    const tv = setup({ color: '#ff0000', n: 5 })
    expect(tv.validateTemplateValue('{{color}}', 'string')).toEqual({ ok: true })
    const r = tv.validateTemplateValue('{{n}}', 'string')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('needs text')
  })

  it('string kind: interpolation with non-string variables is allowed', () => {
    const tv = setup({ n: 5 })
    expect(tv.validateTemplateValue('value: {{n}}', 'string')).toEqual({ ok: true })
  })

  it('any kind: any defined placeholder passes regardless of type', () => {
    const tv = setup({ obj: { a: 1 }, flag: false })
    expect(tv.validateTemplateValue('{{obj}}', 'any')).toEqual({ ok: true })
    expect(tv.validateTemplateValue('{{flag}}', 'any')).toEqual({ ok: true })
  })

  it('dot paths into variables validate and type-check', () => {
    const tv = setup({ user: { name: 'Ann', age: 30 } })
    expect(tv.validateTemplateValue('{{user.age}}', 'number')).toEqual({ ok: true })
    expect(tv.validateTemplateValue('{{user.name}}', 'number').ok).toBe(false)
    expect(tv.validateTemplateValue('{{user.ghost}}', 'any').ok).toBe(false)
  })

  it('scene variables extend and shadow the project scope', () => {
    const tv = setup({ n: 'project-string' })
    const scene = { _id: 's1', variables: { n: 7, local: 'txt' } }
    expect(tv.validateTemplateValue('{{n}}', 'number', scene)).toEqual({ ok: true })
    expect(tv.validateTemplateValue('{{local}}', 'string', scene)).toEqual({ ok: true })
    // without the scene, the project value (a string) fails numeric fields
    expect(tv.validateTemplateValue('{{n}}', 'number').ok).toBe(false)
  })

  it('iterate scenes bind the first item and index for validation', () => {
    const tv = setup({ slides: [{ title: 'a', dur: 2 }] })
    const scene = { _id: 's1', iterate: 'slides', iterateAs: 's' }
    expect(tv.validateTemplateValue('{{s.dur}}', 'number', scene)).toEqual({ ok: true })
    expect(tv.validateTemplateValue('{{s.title}}', 'string', scene)).toEqual({ ok: true })
    expect(tv.validateTemplateValue('{{s.title}}', 'number', scene).ok).toBe(false)
    expect(tv.validateTemplateValue('{{index}}', 'number', scene)).toEqual({ ok: true })
    // alias not bound outside the scene
    expect(tv.validateTemplateValue('{{s.dur}}', 'number').ok).toBe(false)
  })

  it('broken iterate (empty or missing source) leaves the alias unbound', () => {
    const tv = setup({ slides: [] })
    const scene = { _id: 's1', iterate: 'slides', iterateAs: 's' }
    expect(tv.validateTemplateValue('{{s.title}}', 'any', scene).ok).toBe(false)
    const scene2 = { _id: 's2', iterate: 'ghost', iterateAs: 's' }
    expect(tv.validateTemplateValue('{{s.title}}', 'any', scene2).ok).toBe(false)
  })
})

describe('placeholderOptions', () => {
  const projectVars = {
    title: 'My Movie',
    count: 2,
    flag: true,
    meta: { author: 'A' },
    list: [1, 2],
  }

  it('offers project variables filtered by kind', () => {
    const tv = setup(projectVars)
    expect(tv.placeholderOptions(null, 'string')).toEqual(['title'])
    expect(tv.placeholderOptions(null, 'number')).toEqual(['count'])
    expect(tv.placeholderOptions(null, 'any')).toEqual([
      'title',
      'count',
      'flag',
      'meta',
      'list',
    ])
  })

  it('skips variables with invalid names', () => {
    const tv = setup({ ok: 'x', '9bad': 'y' })
    expect(tv.placeholderOptions(null, 'any')).toEqual(['ok'])
  })

  it('includes scene variables without duplicating shadowed names', () => {
    const tv = setup({ title: 'p', shared: 'p' })
    const scene = { _id: 's', variables: { shared: 'scene', extra: 'e' } }
    expect(tv.placeholderOptions(scene, 'string')).toEqual(['title', 'shared', 'extra'])
  })

  it('scene variable shadowing changes the effective kind', () => {
    const tv = setup({ v: 'text' })
    const scene = { _id: 's', variables: { v: 42 } }
    expect(tv.placeholderOptions(scene, 'number')).toEqual(['v'])
    expect(tv.placeholderOptions(null, 'number')).toEqual([])
  })

  it('iterate scenes offer alias.key dot-paths from the first item, plus index', () => {
    const tv = setup({ slides: [{ caption: 'c', dur: 2 }] })
    const scene = { _id: 's', iterate: 'slides', iterateAs: 's' }
    expect(tv.placeholderOptions(scene, 'any')).toEqual([
      'slides',
      's.caption',
      's.dur',
      'index',
    ])
    expect(tv.placeholderOptions(scene, 'number')).toEqual(['s.dur', 'index'])
    // index is excluded for string fields
    expect(tv.placeholderOptions(scene, 'string')).toEqual(['s.caption'])
  })

  it('primitive iterate items offer the bare alias', () => {
    const tv = setup({ names: ['a', 'b'] })
    const scene = { _id: 's', iterate: 'names', iterateAs: 'name' }
    expect(tv.placeholderOptions(scene, 'string')).toEqual(['name'])
    // for numbers, only index qualifies
    expect(tv.placeholderOptions(scene, 'number')).toEqual(['index'])
  })

  it('broken iterate offers no alias/index entries', () => {
    const tv = setup({ title: 't' })
    const scene = { _id: 's', iterate: 'ghost', iterateAs: 's' }
    expect(tv.placeholderOptions(scene, 'any')).toEqual(['title'])
  })

  it('non-iterate scenes never offer index', () => {
    const tv = setup({ n: 1 })
    const scene = { _id: 's', variables: { m: 2 } }
    expect(tv.placeholderOptions(scene, 'number')).toEqual(['n', 'm'])
  })

  it('a project variable named "index" duplicates in iterate scenes', () => {
    // NOTE: possible bug — the iterate branch appends 'index' unconditionally
    // (plain push, no dedupe), so a user variable named `index` yields the
    // option twice. Asserting current behavior.
    const tv = setup({ index: 9, slides: [{ a: 1 }] })
    const scene = { _id: 's', iterate: 'slides', iterateAs: 's' }
    const opts = tv.placeholderOptions(scene, 'number')
    expect(opts.filter((o) => o === 'index')).toHaveLength(2)
  })
})

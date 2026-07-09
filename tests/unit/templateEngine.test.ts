import { describe, it, expect } from 'vitest'
import {
  createScope,
  createReport,
  declareVariables,
  buildProjectScope,
  sceneScopeFor,
  itemScopeFor,
  lookupPath,
  resolvePreviewString,
  isTruthy,
  isValidVarName,
  isValidPath,
  previewCondition,
  previewIterate,
  resolvePreviewNode,
  resolveScenesForPreview,
  resolveDocPreview,
  collectPlaceholders,
  collectIterateRoots,
  quoteBarePlaceholders,
  parseTemplateJson,
  variableTypeOf,
  hasPlaceholder,
  nodeHasPlaceholders,
  hasTemplateMarkers,
} from '../../shared/template/engine'

/** Fresh project scope with the given variable defaults. */
function scopeWith(vars: Record<string, unknown>) {
  return buildProjectScope(vars)
}

describe('lookupPath', () => {
  it('finds a plain variable', () => {
    const s = scopeWith({ name: 'Zed' })
    expect(lookupPath(s, 'name')).toEqual({ found: true, value: 'Zed' })
  })

  it('walks dot paths through objects', () => {
    const s = scopeWith({ user: { profile: { name: 'Ann' } } })
    expect(lookupPath(s, 'user.profile.name').value).toBe('Ann')
  })

  it('indexes arrays with numeric segments', () => {
    const s = scopeWith({ slides: [{ caption: 'first' }, { caption: 'second' }] })
    expect(lookupPath(s, 'slides.1.caption').value).toBe('second')
    expect(lookupPath(s, 'slides.0.caption').value).toBe('first')
  })

  it('reports out-of-range array indices as not found (not invalid)', () => {
    const s = scopeWith({ arr: [1, 2] })
    expect(lookupPath(s, 'arr.2')).toEqual({ found: false })
    const r = lookupPath(s, 'arr.5')
    expect(r.found).toBe(false)
    expect(r.invalid).toBeUndefined()
  })

  it('rejects non-integer segments on arrays (e.g. "length")', () => {
    const s = scopeWith({ arr: [1, 2, 3] })
    // "length" passes the segment syntax but arrays only accept indices
    expect(lookupPath(s, 'arr.length')).toEqual({ found: false })
  })

  it('marks negative indices as invalid syntax', () => {
    const s = scopeWith({ arr: [1] })
    expect(lookupPath(s, 'arr.-1')).toEqual({ found: false, invalid: true })
  })

  it('rejects __proto__ / constructor / prototype segments as invalid', () => {
    const s = scopeWith({ a: { b: 1 } })
    expect(lookupPath(s, '__proto__')).toEqual({ found: false, invalid: true })
    expect(lookupPath(s, 'a.__proto__')).toEqual({ found: false, invalid: true })
    expect(lookupPath(s, 'a.constructor')).toEqual({ found: false, invalid: true })
    expect(lookupPath(s, 'a.prototype')).toEqual({ found: false, invalid: true })
  })

  it('only sees own properties, never the prototype chain', () => {
    const s = scopeWith({ obj: { x: 1 } })
    expect(lookupPath(s, 'obj.toString')).toEqual({ found: false })
    expect(lookupPath(s, 'obj.hasOwnProperty')).toEqual({ found: false })
  })

  it('rejects a numeric first segment (paths must start with a var name)', () => {
    const s = scopeWith({})
    expect(lookupPath(s, '0.foo')).toEqual({ found: false, invalid: true })
  })

  it('stops descending through primitives', () => {
    const s = scopeWith({ n: 5, str: 'hi' })
    expect(lookupPath(s, 'n.x')).toEqual({ found: false })
    expect(lookupPath(s, 'str.0')).toEqual({ found: false })
  })

  it('walks the parent scope chain with child shadowing', () => {
    const parent = scopeWith({ a: 1, b: 2 })
    const child = createScope(parent)
    child.vars.set('a', 10)
    expect(lookupPath(child, 'a').value).toBe(10)
    expect(lookupPath(child, 'b').value).toBe(2)
    expect(lookupPath(parent, 'a').value).toBe(1)
  })

  it('missing root variable is not found and not invalid', () => {
    const r = lookupPath(scopeWith({}), 'nope')
    expect(r.found).toBe(false)
    expect(r.invalid).toBeUndefined()
  })

  it('empty segment ("a..b") is invalid', () => {
    expect(lookupPath(scopeWith({ a: 1 }), 'a..b')).toEqual({
      found: false,
      invalid: true,
    })
  })
})

describe('resolvePreviewString', () => {
  const scope = scopeWith({
    name: 'Zed',
    n: 42,
    flag: false,
    nil: null,
    obj: { a: 1 },
    arr: [1, 2],
  })

  it('passes through strings without placeholders and non-strings', () => {
    expect(resolvePreviewString('plain', scope)).toBe('plain')
    expect(resolvePreviewString(7 as any, scope)).toBe(7)
    expect(resolvePreviewString('half open {{', scope)).toBe('half open {{')
  })

  it('whole-string single placeholder preserves the value type', () => {
    expect(resolvePreviewString('{{n}}', scope)).toBe(42)
    expect(resolvePreviewString('{{flag}}', scope)).toBe(false)
    expect(resolvePreviewString('{{nil}}', scope)).toBe(null)
    expect(resolvePreviewString('{{obj}}', scope)).toEqual({ a: 1 })
    expect(resolvePreviewString('{{arr}}', scope)).toEqual([1, 2])
  })

  it('whole-string placeholder returns the SAME object reference', () => {
    const vars = { item: { a: 1 } }
    const s = scopeWith(vars)
    expect(resolvePreviewString('{{item}}', s)).toBe(vars.item)
  })

  it('trims whitespace inside the braces', () => {
    expect(resolvePreviewString('{{ name }}', scope)).toBe('Zed')
  })

  it('surrounding text forces interpolation (stringified)', () => {
    expect(resolvePreviewString('n={{n}}', scope)).toBe('n=42')
    expect(resolvePreviewString(' {{n}} ', scope)).toBe(' 42 ')
  })

  it('two placeholders always interpolate, even when both resolve', () => {
    expect(resolvePreviewString('{{n}}{{n}}', scope)).toBe('4242')
  })

  it('stringifies objects as JSON, null/undefined as empty string', () => {
    expect(resolvePreviewString('v: {{obj}}|{{nil}}|{{flag}}', scope)).toBe(
      'v: {"a":1}||false'
    )
  })

  it('leaves missing placeholders literal and reports the root name', () => {
    const report = createReport()
    expect(resolvePreviewString('{{missing}}', scope, report)).toBe('{{missing}}')
    expect([...report.missing]).toEqual(['missing'])
  })

  it('a found root with a missing sub-path reports the root', () => {
    const report = createReport()
    expect(resolvePreviewString('{{obj.zzz}}', scope, report)).toBe('{{obj.zzz}}')
    expect(report.missing.has('obj')).toBe(true)
  })

  it('invalid expressions stay literal and are reported verbatim', () => {
    const report = createReport()
    expect(resolvePreviewString('{{a b}}', scope, report)).toBe('{{a b}}')
    expect(report.invalid.has('a b')).toBe(true)
    expect(resolvePreviewString('{{}}', scope, report)).toBe('{{}}')
    expect(report.invalid.has('')).toBe(true)
  })

  it('mixed resolved + unresolved: only resolvable parts substitute', () => {
    const report = createReport()
    expect(resolvePreviewString('{{name}} vs {{missing}}', scope, report)).toBe(
      'Zed vs {{missing}}'
    )
    expect(report.missing.has('missing')).toBe(true)
  })
})

describe('declareVariables', () => {
  it('resolves chained variables independent of declaration order', () => {
    const a = declareVariables(createScope(), { greeting: '{{word}}', word: 'hello' })
    expect(a.vars.get('greeting')).toBe('hello')
    const b = declareVariables(createScope(), { word: 'hello', greeting: '{{word}}' })
    expect(b.vars.get('greeting')).toBe('hello')
  })

  it('resolves multi-hop chains across passes', () => {
    const s = declareVariables(createScope(), {
      a: '{{b}}!',
      b: '{{c}}',
      c: 'x',
    })
    expect(s.vars.get('a')).toBe('x!')
    expect(s.vars.get('b')).toBe('x')
  })

  it('resolves dot-path references between variables', () => {
    const s = declareVariables(createScope(), {
      first: '{{user.name}}',
      user: { name: 'Ann' },
    })
    expect(s.vars.get('first')).toBe('Ann')
  })

  it('whole-string chains preserve non-string types', () => {
    const s = declareVariables(createScope(), { copy: '{{n}}', n: 42 })
    expect(s.vars.get('copy')).toBe(42)
  })

  it('a self-referencing variable terminates and stays literal', () => {
    const s = declareVariables(createScope(), { a: '{{a}}' })
    expect(s.vars.get('a')).toBe('{{a}}')
  })

  it('a two-variable cycle terminates with literal placeholders', () => {
    const s = declareVariables(createScope(), { a: '{{b}}', b: '{{a}}' })
    // pass 1 collapses the cycle onto a self-reference, which then stalls
    expect(s.vars.get('a')).toBe('{{a}}')
    expect(s.vars.get('b')).toBe('{{a}}')
  })

  it('a three-variable cycle terminates (bounded passes) and stays literal', () => {
    const s = declareVariables(createScope(), {
      a: '{{b}}',
      b: '{{c}}',
      c: '{{a}}',
    })
    for (const k of ['a', 'b', 'c']) {
      expect(String(s.vars.get(k))).toContain('{{')
    }
  })

  it('skips invalid and forbidden variable names', () => {
    const s = declareVariables(createScope(), {
      ok: 1,
      '9bad': 2,
      'has-dash': 3,
      constructor: 4,
      __proto__: 5,
    } as any)
    expect(s.vars.has('ok')).toBe(true)
    expect(s.vars.size).toBe(1)
  })

  it('leaves non-string values untouched', () => {
    const s = declareVariables(createScope(), { n: 3, arr: [1], obj: { a: 1 } })
    expect(s.vars.get('n')).toBe(3)
    expect(s.vars.get('arr')).toEqual([1])
  })

  it('unresolvable references stay literal', () => {
    const s = declareVariables(createScope(), { a: '{{nothere}}' })
    expect(s.vars.get('a')).toBe('{{nothere}}')
  })
})

describe('buildProjectScope / sceneScopeFor / itemScopeFor', () => {
  it('buildProjectScope declares object variables', () => {
    const s = buildProjectScope({ a: 1 })
    expect(s.vars.get('a')).toBe(1)
    expect(s.parent).toBeNull()
  })

  it('buildProjectScope ignores non-object inputs', () => {
    expect(buildProjectScope(null).vars.size).toBe(0)
    expect(buildProjectScope([1, 2]).vars.size).toBe(0)
    expect(buildProjectScope('x').vars.size).toBe(0)
    expect(buildProjectScope(undefined).vars.size).toBe(0)
  })

  it('sceneScopeFor returns the project scope itself when the scene has no variables', () => {
    const ps = scopeWith({ a: 1 })
    expect(sceneScopeFor({}, ps)).toBe(ps)
    expect(sceneScopeFor({ variables: null } as any, ps)).toBe(ps)
    expect(sceneScopeFor({ variables: [1] } as any, ps)).toBe(ps)
  })

  it('sceneScopeFor creates a child scope that shadows project variables', () => {
    const ps = scopeWith({ a: 1 })
    const child = sceneScopeFor({ variables: { a: 2, b: 3 } }, ps)
    expect(child).not.toBe(ps)
    expect(child.parent).toBe(ps)
    expect(lookupPath(child, 'a').value).toBe(2)
    expect(lookupPath(child, 'b').value).toBe(3)
    expect(lookupPath(ps, 'a').value).toBe(1) // parent untouched
  })

  it('itemScopeFor binds the alias, the index and keeps the parent chain', () => {
    const ps = scopeWith({ a: 1 })
    const s = itemScopeFor(ps, 'slide', { t: 'x' }, 4)
    expect(lookupPath(s, 'slide.t').value).toBe('x')
    expect(lookupPath(s, 'index').value).toBe(4)
    expect(lookupPath(s, 'a').value).toBe(1)
  })

  it('an alias literally named "index" is overwritten by the index binding', () => {
    // NOTE: documented behavior — `index` is set after the alias, so it wins
    const s = itemScopeFor(scopeWith({}), 'index', 'item-value', 2)
    expect(lookupPath(s, 'index').value).toBe(2)
  })
})

describe('previewCondition', () => {
  const scope = scopeWith({ on: true, off: false, zero: 0, empty: '', n: 3, s: 'x' })

  it('absent condition is shown and resolved', () => {
    expect(previewCondition(undefined, scope)).toEqual({ shown: true, resolved: true })
  })

  it('orch falsy values hide: false, 0, "", null', () => {
    for (const v of [false, 0, '', null]) {
      expect(previewCondition(v, scope)).toEqual({ shown: false, resolved: true })
    }
  })

  it('truthy literals show: true, 1, -1, arrays, objects', () => {
    for (const v of [true, 1, -1, [], {}, [0]]) {
      expect(previewCondition(v, scope).shown).toBe(true)
    }
  })

  it('a plain string without placeholders is truthy, even "false"', () => {
    expect(previewCondition('false', scope)).toEqual({ shown: true, resolved: true })
    expect(previewCondition('0', scope)).toEqual({ shown: true, resolved: true })
  })

  it('placeholder strings resolve to their variable truthiness', () => {
    expect(previewCondition('{{on}}', scope)).toEqual({ shown: true, resolved: true })
    expect(previewCondition('{{off}}', scope)).toEqual({ shown: false, resolved: true })
    expect(previewCondition('{{zero}}', scope)).toEqual({ shown: false, resolved: true })
    expect(previewCondition('{{empty}}', scope)).toEqual({ shown: false, resolved: true })
    expect(previewCondition('{{n}}', scope)).toEqual({ shown: true, resolved: true })
  })

  it('unresolvable conditions stay shown but report resolved: false', () => {
    expect(previewCondition('{{missing}}', scope)).toEqual({
      shown: true,
      resolved: false,
    })
    expect(previewCondition('{{not valid}}', scope)).toEqual({
      shown: true,
      resolved: false,
    })
  })

  it('isTruthy matches orch semantics', () => {
    expect(isTruthy(undefined)).toBe(false)
    expect(isTruthy(null)).toBe(false)
    expect(isTruthy(0)).toBe(false)
    expect(isTruthy('')).toBe(false)
    expect(isTruthy(false)).toBe(false)
    expect(isTruthy([])).toBe(true)
    expect(isTruthy('no')).toBe(true)
    expect(isTruthy(-0)).toBe(false) // -0 === 0
  })
})

describe('previewIterate', () => {
  const ps = scopeWith({
    slides: [{ c: 'a' }, { c: 'b' }],
    notArray: 'x',
    data: { rows: [1, 2, 3] },
  })

  it('inactive when the scene has no iterate (null or undefined)', () => {
    expect(previewIterate({}, ps)).toEqual({
      active: false,
      path: '',
      alias: 'item',
      items: null,
      error: null,
    })
    expect(previewIterate({ iterate: null }, ps).active).toBe(false)
  })

  it('resolves an array with the default alias "item"', () => {
    const r = previewIterate({ iterate: 'slides' }, ps)
    expect(r).toEqual({
      active: true,
      path: 'slides',
      alias: 'item',
      items: [{ c: 'a' }, { c: 'b' }],
      error: null,
    })
  })

  it('honors iterateAs and dot-path iterate sources', () => {
    const r = previewIterate({ iterate: 'data.rows', iterateAs: 'row' }, ps)
    expect(r.alias).toBe('row')
    expect(r.items).toEqual([1, 2, 3])
  })

  it('errors on non-array values', () => {
    const r = previewIterate({ iterate: 'notArray' }, ps)
    expect(r.items).toBeNull()
    expect(r.error).toBe('"notArray" is not an array')
  })

  it('errors on undefined variables', () => {
    const r = previewIterate({ iterate: 'ghost' }, ps)
    expect(r.error).toBe('"ghost" is not a defined variable')
  })

  it('errors on an invalid alias', () => {
    const r = previewIterate({ iterate: 'slides', iterateAs: '2bad' }, ps)
    expect(r.error).toBe('Invalid alias "2bad"')
    expect(r.items).toBeNull()
  })

  it('resolves against the PROJECT scope — scene variables cannot drive iterate', () => {
    // NOTE: documented behavior (orch parity): iterate paths ignore scene vars
    const r = previewIterate({ variables: { rows: [1] }, iterate: 'rows' }, ps)
    expect(r.error).toBe('"rows" is not a defined variable')
  })
})

describe('resolvePreviewNode', () => {
  const scope = scopeWith({ name: 'Zed', n: 5, off: false, on: true })

  it('deep-resolves strings, preserves _id and non-strings', () => {
    const node = {
      _id: 'v1',
      text: 'Hi {{name}}',
      width: '{{n}}',
      count: 3,
      nested: { arr: ['{{n}}', 'x', null, 7] },
    }
    const out = resolvePreviewNode(node, scope)
    expect(out).toEqual({
      _id: 'v1',
      text: 'Hi Zed',
      width: 5, // whole-string placeholder keeps the number type
      count: 3,
      nested: { arr: [5, 'x', null, 7] },
    })
  })

  it('keeps template keys raw (condition/iterate/iterateAs/variables)', () => {
    const node = {
      condition: '{{name}}',
      iterate: '{{name}}',
      iterateAs: '{{name}}',
      variables: { x: '{{name}}' },
      text: '{{name}}',
    }
    const out = resolvePreviewNode(node, scope)
    expect(out.condition).toBe('{{name}}')
    expect(out.iterate).toBe('{{name}}')
    expect(out.iterateAs).toBe('{{name}}')
    expect(out.variables).toEqual({ x: '{{name}}' })
    expect(out.text).toBe('Zed')
  })

  it('drops forbidden keys from objects', () => {
    const node = JSON.parse('{"__proto__": 1, "constructor": 2, "a": "{{n}}"}')
    const out: any = resolvePreviewNode(node, scope)
    expect(Object.prototype.hasOwnProperty.call(out, '__proto__')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(out, 'constructor')).toBe(false)
    expect(out.a).toBe(5)
  })

  it('prune drops array items whose condition resolves falsy', () => {
    const arr = [
      { id: 1, condition: '{{off}}' },
      { id: 2, condition: '{{on}}' },
      { id: 3 },
      { id: 4, condition: '{{unknown}}' }, // unresolvable → kept
      { id: 5, condition: false },
    ]
    const out = resolvePreviewNode(arr, scope, undefined, { prune: true })
    expect(out.map((x: any) => x.id)).toEqual([2, 3, 4])
  })

  it('without prune, condition-falsy items are kept', () => {
    const arr = [{ id: 1, condition: false }]
    expect(resolvePreviewNode(arr, scope)).toHaveLength(1)
  })

  it('records unresolved placeholders in the report while resolving', () => {
    const report = createReport()
    resolvePreviewNode({ a: '{{ghost}}', b: ['{{bad expr}}'] }, scope, report)
    expect(report.missing.has('ghost')).toBe(true)
    expect(report.invalid.has('bad expr')).toBe(true)
  })

  it('passes primitives through', () => {
    expect(resolvePreviewNode(7, scope)).toBe(7)
    expect(resolvePreviewNode(null, scope)).toBe(null)
    expect(resolvePreviewNode(true, scope)).toBe(true)
  })
})

describe('resolveScenesForPreview', () => {
  it('non-iterate scene: resolved copy with _sourceId', () => {
    const ps = scopeWith({ title: 'T' })
    const scene = { _id: 'scn_a', id: 'intro', visuals: [{ _id: 'v', text: '{{title}}' }] }
    const out = resolveScenesForPreview([scene], ps)
    expect(out).toHaveLength(1)
    expect(out[0]._sourceId).toBe('scn_a')
    expect(out[0]._id).toBe('scn_a')
    expect(out[0].visuals[0].text).toBe('T')
  })

  it('non-iterate scene with falsy condition is dropped', () => {
    const ps = scopeWith({ show: false })
    const out = resolveScenesForPreview([{ _id: 's', condition: '{{show}}' }], ps)
    expect(out).toEqual([])
  })

  it('non-iterate scene with unresolvable condition is kept (lenient)', () => {
    const ps = scopeWith({})
    const out = resolveScenesForPreview([{ _id: 's', condition: '{{ghost}}' }], ps)
    expect(out).toHaveLength(1)
  })

  it('scene condition sees scene-level variables', () => {
    const ps = scopeWith({})
    const out = resolveScenesForPreview(
      [{ _id: 's', variables: { show: false }, condition: '{{show}}' }],
      ps
    )
    expect(out).toEqual([])
  })

  it('iterate expands to one scene per item with id/_id/_sourceId bookkeeping', () => {
    const ps = scopeWith({ slides: [{ c: 'A' }, { c: 'B' }, { c: 'C' }] })
    const scene = {
      _id: 'scn_1',
      id: 'body',
      iterate: 'slides',
      iterateAs: 's',
      visuals: [{ _id: 'v1', text: '{{s.c}} #{{index}}' }],
      audios: [{ _id: 'a1', src: 'x.mp3' }],
    }
    const out = resolveScenesForPreview([scene], ps)
    expect(out).toHaveLength(3)
    expect(out.map((s) => s.id)).toEqual(['body-0', 'body-1', 'body-2'])
    // first clone keeps the source _id, later clones get ~index suffixes
    expect(out.map((s) => s._id)).toEqual(['scn_1', 'scn_1~1', 'scn_1~2'])
    expect(out.map((s) => s._sourceId)).toEqual(['scn_1', 'scn_1', 'scn_1'])
    expect(out.map((s) => s.visuals[0].text)).toEqual(['A #0', 'B #1', 'C #2'])
    // pooled audio elements get distinct _ids on clones
    expect(out.map((s) => s.audios[0]._id)).toEqual(['a1', 'a1~1', 'a1~2'])
  })

  it('iterate clones chain transitions to each other; last keeps the original', () => {
    const ps = scopeWith({ slides: [1, 2, 3] })
    const scene = {
      _id: 'scn_1',
      id: 'body',
      iterate: 'slides',
      transition: 'fade',
      transitionId: 'outro',
      visuals: [],
      audios: [],
    }
    const out = resolveScenesForPreview([scene], ps)
    expect(out[0].transitionId).toBe('body-1')
    expect(out[1].transitionId).toBe('body-2')
    expect(out[2].transitionId).toBe('outro')
  })

  it('re-points a preceding transitionId at the first expanded clone', () => {
    const ps = scopeWith({ slides: ['x', 'y'] })
    const intro = { _id: 'A', id: 'intro', transition: 'fade', transitionId: 'body' }
    const body = { _id: 'B', id: 'body', iterate: 'slides', visuals: [], audios: [] }
    const out = resolveScenesForPreview([intro, body], ps)
    expect(out.map((s) => s.id)).toEqual(['intro', 'body-0', 'body-1'])
    expect(out[0].transitionId).toBe('body-0')
  })

  it('resolves placeholders inside transitionId on plain scenes', () => {
    const ps = scopeWith({ next: 'outro' })
    const out = resolveScenesForPreview(
      [{ _id: 's', id: 'intro', transition: 'fade', transitionId: '{{next}}' }],
      ps
    )
    expect(out[0].transitionId).toBe('outro')
  })

  it('per-item conditions skip items but keep original item indices in ids', () => {
    const ps = scopeWith({
      slides: [{ show: true }, { show: false }, { show: true }],
    })
    const scene = {
      _id: 'scn',
      id: 'sec',
      iterate: 'slides',
      iterateAs: 's',
      condition: '{{s.show}}',
      visuals: [],
      audios: [],
    }
    const out = resolveScenesForPreview([scene], ps)
    expect(out.map((s) => s.id)).toEqual(['sec-0', 'sec-2'])
    expect(out.map((s) => s._id)).toEqual(['scn', 'scn~2'])
  })

  it('nested iterate + item conditions prune visuals per clone', () => {
    const ps = scopeWith({
      slides: [
        { c: 'A', showText: true },
        { c: 'B', showText: false },
      ],
    })
    const scene = {
      _id: 'scn',
      id: 'sec',
      iterate: 'slides',
      iterateAs: 's',
      visuals: [{ _id: 'v', text: '{{s.c}}', condition: '{{s.showText}}' }],
      audios: [],
    }
    const out = resolveScenesForPreview([scene], ps)
    expect(out[0].visuals).toHaveLength(1)
    expect(out[0].visuals[0].text).toBe('A')
    expect(out[1].visuals).toHaveLength(0)
  })

  it('broken iterate (missing variable) keeps a single resolved copy', () => {
    const ps = scopeWith({ title: 'T' })
    const scene = { _id: 's', id: 'x', iterate: 'ghost', visuals: [{ text: '{{title}}' }] }
    const out = resolveScenesForPreview([scene], ps)
    expect(out).toHaveLength(1)
    expect(out[0]._sourceId).toBe('s')
    expect(out[0].iterate).toBe('ghost') // template key rides through raw
    expect(out[0].visuals[0].text).toBe('T')
  })

  it('iterate over a non-array keeps one copy too', () => {
    const ps = scopeWith({ notArray: 'x' })
    const out = resolveScenesForPreview([{ _id: 's', iterate: 'notArray' }], ps)
    expect(out).toHaveLength(1)
  })

  it('scene-level variables are visible inside iterate clones', () => {
    const ps = scopeWith({ slides: [{ c: 'A' }] })
    const scene = {
      _id: 's',
      id: 'x',
      variables: { prefix: 'S:' },
      iterate: 'slides',
      iterateAs: 'it',
      visuals: [{ text: '{{prefix}}{{it.c}}' }],
      audios: [],
    }
    const out = resolveScenesForPreview([scene], ps)
    expect(out[0].visuals[0].text).toBe('S:A')
  })

  it('caps expansion at 100 items', () => {
    const ps = scopeWith({ many: Array.from({ length: 150 }, (_, i) => i) })
    const out = resolveScenesForPreview(
      [{ _id: 's', id: 'x', iterate: 'many', visuals: [], audios: [] }],
      ps
    )
    expect(out).toHaveLength(100)
  })

  it('a scene without an id falls back to positional scene-N ids', () => {
    const ps = scopeWith({ slides: [1, 2] })
    const out = resolveScenesForPreview(
      [{ _id: 's', iterate: 'slides', visuals: [], audios: [] }],
      ps
    )
    expect(out.map((s) => s.id)).toEqual(['scene-1-0', 'scene-1-1'])
  })

  it('non-object scene entries pass through untouched', () => {
    const out = resolveScenesForPreview([null as any, 'weird' as any], scopeWith({}))
    expect(out).toEqual([null, 'weird'])
  })
})

describe('resolveDocPreview', () => {
  it('resolves the full document: expansion, pruning, type-preserving fields', () => {
    const doc: any = {
      name: '{{title}}',
      duration: '{{dur}}',
      extra: { variables: { ignored: true }, keep: 1 },
      variables: { rawKey: '{{title}}' },
      visuals: [
        { _id: 'rv1', type: 'TEXT', text: '{{title}}' },
        { _id: 'rv2', type: 'TEXT', text: 'gone', condition: false },
      ],
      scenes: [
        {
          _id: 'scn',
          id: 'body',
          iterate: 'slides',
          iterateAs: 's',
          visuals: [{ text: '{{s}}' }],
          audios: [],
        },
      ],
    }
    const vars = { title: 'My Movie', dur: 12, slides: ['one', 'two'] }
    const out = resolveDocPreview(doc, vars)

    expect(out.name).toBe('My Movie')
    expect(out.duration).toBe(12) // number, not "12"
    expect(out.extra).toBe(doc.extra) // rides through untouched
    expect(out.variables).toBe(doc.variables) // template key kept raw
    expect(out.visuals).toHaveLength(1) // condition-falsy root visual pruned
    expect(out.visuals[0].text).toBe('My Movie')
    expect(out.scenes).toHaveLength(2) // iterate expanded
    expect(out.scenes.map((s: any) => s.visuals[0].text)).toEqual(['one', 'two'])
  })

  it('an empty doc with no variables passes through structurally', () => {
    const out = resolveDocPreview({ visuals: [], audios: [] } as any, {})
    expect(out).toEqual({ visuals: [], audios: [] })
  })
})

describe('collectPlaceholders / collectIterateRoots', () => {
  it('counts placeholder roots (dot paths count their root) and gathers invalids', () => {
    const node = {
      a: '{{x}} and {{x.y}}',
      b: ['{{y}}', { c: '{{bad expr}}' }],
      n: 5,
    }
    const { roots, invalid } = collectPlaceholders(node)
    expect(roots.get('x')).toBe(2)
    expect(roots.get('y')).toBe(1)
    expect(roots.size).toBe(2)
    expect([...invalid]).toEqual(['bad expr'])
  })

  it('returns empty results for placeholder-free nodes', () => {
    const { roots, invalid } = collectPlaceholders({ a: 1, b: 'plain' })
    expect(roots.size).toBe(0)
    expect(invalid.size).toBe(0)
  })

  it('collectIterateRoots counts scene iterate roots, skipping invalid names', () => {
    const roots = collectIterateRoots({
      scenes: [
        { iterate: 'slides' },
        { iterate: 'data.rows' },
        { iterate: 'slides' },
        { iterate: '9bad' },
        {},
      ],
    })
    expect(roots.get('slides')).toBe(2)
    expect(roots.get('data')).toBe(1)
    expect(roots.size).toBe(2)
  })

  it('collectIterateRoots handles missing scenes', () => {
    expect(collectIterateRoots({}).size).toBe(0)
    expect(collectIterateRoots(undefined as any).size).toBe(0)
  })
})

describe('quoteBarePlaceholders / parseTemplateJson', () => {
  it('wraps bare placeholders outside string literals in quotes', () => {
    expect(quoteBarePlaceholders('{"a": {{x}}, "b": "{{y}}"}')).toBe(
      '{"a": "{{x}}", "b": "{{y}}"}'
    )
  })

  it('leaves placeholders inside strings (and escaped quotes) untouched', () => {
    const text = '{"a": "say \\" {{x}}", "b": {{y}}}'
    expect(quoteBarePlaceholders(text)).toBe('{"a": "say \\" {{x}}", "b": "{{y}}"}')
  })

  it('an unterminated {{ passes through unchanged', () => {
    expect(quoteBarePlaceholders('{"a": {{x}')).toBe('{"a": {{x}')
  })

  it('parseTemplateJson repairs bare placeholders in value position', () => {
    const parsed: any = parseTemplateJson(
      '{"exitEnd": {{item.duration}}, "n": 1, "t": "hi {{name}}"}'
    )
    expect(parsed).toEqual({
      exitEnd: '{{item.duration}}',
      n: 1,
      t: 'hi {{name}}',
    })
  })

  it('keeps inner spacing of the repaired placeholder verbatim', () => {
    const parsed: any = parseTemplateJson('{"d": {{ item.duration }}}')
    expect(parsed.d).toBe('{{ item.duration }}')
  })

  it('parses valid JSON directly', () => {
    expect(parseTemplateJson('{"a":1}')).toEqual({ a: 1 })
  })

  it('throws the ORIGINAL error when the repair still is not JSON', () => {
    expect(() => parseTemplateJson('{"a": {{x}}')).toThrow() // missing closing }
    expect(() => parseTemplateJson('not json at all')).toThrow()
  })
})

describe('placeholder scanners', () => {
  it('hasPlaceholder requires a syntactically valid placeholder', () => {
    expect(hasPlaceholder('{{ok}}')).toBe(true)
    expect(hasPlaceholder('{{a.b.0}}')).toBe(true)
    expect(hasPlaceholder('{{not valid}}')).toBe(false)
    expect(hasPlaceholder('no braces')).toBe(false)
    expect(hasPlaceholder(42)).toBe(false)
  })

  it('nodeHasPlaceholders deep-scans containers', () => {
    expect(nodeHasPlaceholders({ a: [{ b: '{{x}}' }] })).toBe(true)
    expect(nodeHasPlaceholders({ a: [{ b: 'plain' }] })).toBe(false)
  })

  it('hasTemplateMarkers triggers on braces OR condition/iterate keys', () => {
    expect(hasTemplateMarkers('uses {{x}}')).toBe(true)
    expect(hasTemplateMarkers({ condition: true })).toBe(true)
    expect(hasTemplateMarkers([{ iterate: 'slides' }])).toBe(true)
    expect(hasTemplateMarkers({ a: 1, b: ['x'] })).toBe(false)
  })
})

describe('variableTypeOf / name validation', () => {
  it('classifies values', () => {
    expect(variableTypeOf(null)).toBe('null')
    expect(variableTypeOf(undefined)).toBe('null')
    expect(variableTypeOf([1])).toBe('array')
    expect(variableTypeOf(1)).toBe('number')
    expect(variableTypeOf(true)).toBe('boolean')
    expect(variableTypeOf('x')).toBe('string')
    expect(variableTypeOf({})).toBe('object')
  })

  it('isValidVarName / isValidPath basics', () => {
    expect(isValidVarName('good_Name2')).toBe(true)
    expect(isValidVarName('2bad')).toBe(false)
    expect(isValidVarName('constructor')).toBe(false)
    expect(isValidPath('a.b.0')).toBe(true)
    expect(isValidPath('0.a')).toBe(false)
    expect(isValidPath('a.__proto__')).toBe(false)
  })
})

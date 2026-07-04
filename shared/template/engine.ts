/**
 * Template-engine preview: a TypeScript port of orch's
 * services/templateEngine (scopes / substitute / condition / iterate walk),
 * kept semantically identical so what the stage previews is what orch
 * renders. Differences are deliberate and preview-only:
 *
 * - NEVER throws: unresolved/invalid placeholders stay literal and are
 *   reported in `missing` / `invalid` sets instead of errors.
 * - Does not strip template keys or prune conditions — display copies keep
 *   the raw document intact; callers decide how to visualize condition state.
 *
 * Keep in sync with orch/services/templateEngine/* when semantics change.
 */

export const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
export const VAR_NAME = /^[a-zA-Z][a-zA-Z0-9_]*$/
const PATH_SEGMENT = /^(?:[a-zA-Z][a-zA-Z0-9_]*|\d+)$/
export const PLACEHOLDER_RE = /\{\{([\s\S]*?)\}\}/g

/** Keys interpreted by the engine itself — resolution skips their values. */
export const TEMPLATE_KEYS = new Set(['variables', 'condition', 'iterate', 'iterateAs'])

export interface Scope {
  vars: Map<string, unknown>
  parent: Scope | null
}

export function createScope(parent: Scope | null = null): Scope {
  return { vars: new Map(), parent }
}

export function isValidVarName(name: string): boolean {
  return VAR_NAME.test(name) && !FORBIDDEN_KEYS.has(name)
}

export function isValidPath(inner: string): boolean {
  const segments = inner.split('.')
  if (!VAR_NAME.test(segments[0])) return false
  return segments.every((seg) => PATH_SEGMENT.test(seg) && !FORBIDDEN_KEYS.has(seg))
}

function lookupName(scope: Scope, name: string): { found: boolean; value?: unknown } {
  for (let s: Scope | null = scope; s; s = s.parent) {
    if (s.vars.has(name)) return { found: true, value: s.vars.get(name) }
  }
  return { found: false }
}

/** Dot-path lookup ("slides.0.caption") — own properties only, no prototypes. */
export function lookupPath(
  scope: Scope,
  path: string
): { found: boolean; value?: unknown; invalid?: boolean } {
  const segments = String(path).split('.')
  for (const seg of segments) {
    if (FORBIDDEN_KEYS.has(seg) || !PATH_SEGMENT.test(seg)) {
      return { found: false, invalid: true }
    }
  }
  if (!VAR_NAME.test(segments[0])) return { found: false, invalid: true }

  const head = lookupName(scope, segments[0])
  if (!head.found) return { found: false }

  let value: any = head.value
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i]
    if (Array.isArray(value)) {
      const idx = Number(seg)
      if (!Number.isInteger(idx) || idx < 0 || idx >= value.length) {
        return { found: false }
      }
      value = value[idx]
    } else if (value && typeof value === 'object') {
      if (!Object.prototype.hasOwnProperty.call(value, seg)) return { found: false }
      value = value[seg]
    } else {
      return { found: false }
    }
  }
  return { found: true, value }
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

export interface PreviewReport {
  /** valid placeholder roots that did not resolve */
  missing: Set<string>
  /** raw inner expressions that are not valid {{var}} / {{var.path}} */
  invalid: Set<string>
}

export function createReport(): PreviewReport {
  return { missing: new Set(), invalid: new Set() }
}

/**
 * Lenient counterpart of orch's resolveString: a whole-string single
 * placeholder is type-preserving; embedded placeholders interpolate;
 * anything unresolved stays literal and is recorded in the report.
 */
export function resolvePreviewString(
  str: string,
  scope: Scope,
  report?: PreviewReport
): unknown {
  if (typeof str !== 'string' || !str.includes('{{')) return str

  PLACEHOLDER_RE.lastIndex = 0
  const matches = [...str.matchAll(PLACEHOLDER_RE)]
  if (matches.length === 0) return str

  const resolveOne = (rawInner: string): { ok: boolean; value?: unknown } => {
    const inner = rawInner.trim()
    if (!isValidPath(inner)) {
      report?.invalid.add(inner)
      return { ok: false }
    }
    const res = lookupPath(scope, inner)
    if (!res.found) {
      report?.missing.add(inner.split('.')[0])
      return { ok: false }
    }
    return { ok: true, value: res.value }
  }

  if (matches.length === 1 && matches[0][0] === str) {
    const r = resolveOne(matches[0][1])
    return r.ok ? r.value : str
  }

  PLACEHOLDER_RE.lastIndex = 0
  return str.replace(PLACEHOLDER_RE, (match, rawInner) => {
    const r = resolveOne(rawInner)
    return r.ok ? stringifyValue(r.value) : match
  })
}

/** Bounded chained resolution (self/cyclic references terminate literal). */
const MAX_CHAIN_PASSES = 10

/**
 * Variable declaration with orch's lenient chaining, order-INDEPENDENT:
 * values are declared first, then string values are re-resolved against the
 * full scope while progress is made (mirrors orch scopes.js — MySQL JSON
 * columns re-sort object keys, so order must not matter).
 */
export function declareVariables(
  scope: Scope,
  variables: Record<string, unknown>
): Scope {
  const declared: string[] = []
  for (const [name, value] of Object.entries(variables)) {
    if (!isValidVarName(name)) continue
    scope.vars.set(name, value)
    declared.push(name)
  }
  for (let pass = 0; pass < MAX_CHAIN_PASSES; pass++) {
    let changed = false
    for (const name of declared) {
      const value = scope.vars.get(name)
      if (typeof value !== 'string' || !value.includes('{{')) continue
      const resolved = resolvePreviewString(value, scope)
      if (resolved !== value) {
        scope.vars.set(name, resolved)
        changed = true
      }
    }
    if (!changed) break
  }
  return scope
}

/** Project-level scope from the document's `variables` defaults. */
export function buildProjectScope(variables: unknown): Scope {
  const scope = createScope(null)
  if (variables && typeof variables === 'object' && !Array.isArray(variables)) {
    declareVariables(scope, variables as Record<string, unknown>)
  }
  return scope
}

/** Scene child scope when the scene declares its own `variables`. */
export function sceneScopeFor(scene: Record<string, any>, projectScope: Scope): Scope {
  const v = scene?.variables
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return declareVariables(createScope(projectScope), v)
  }
  return projectScope
}

/** Item scope for previewing one iteration (orch sets `alias` and `index`). */
export function itemScopeFor(
  sceneScope: Scope,
  alias: string,
  item: unknown,
  index: number
): Scope {
  const scope = createScope(sceneScope)
  scope.vars.set(alias, item)
  scope.vars.set('index', index)
  return scope
}

/** orch truthiness: false, 0, "", null, undefined → falsy. */
export function isTruthy(value: unknown): boolean {
  return !(
    value === false ||
    value === 0 ||
    value === '' ||
    value === null ||
    value === undefined
  )
}

export interface ConditionPreview {
  /** result after resolution + truthiness */
  shown: boolean
  /** false when the condition references something unresolvable (preview keeps it shown) */
  resolved: boolean
}

export function previewCondition(condition: unknown, scope: Scope): ConditionPreview {
  if (condition === undefined) return { shown: true, resolved: true }
  const report = createReport()
  const value =
    typeof condition === 'string'
      ? resolvePreviewString(condition, scope, report)
      : condition
  const unresolved = report.missing.size > 0 || report.invalid.size > 0
  return { shown: unresolved ? true : isTruthy(value), resolved: !unresolved }
}

export interface IteratePreview {
  active: boolean
  path: string
  alias: string
  items: unknown[] | null
  error: string | null
}

/** Inspect a scene's `iterate` the way orch will interpret it at render. */
export function previewIterate(
  scene: Record<string, any>,
  projectScope: Scope
): IteratePreview {
  if (scene?.iterate == null) {
    return { active: false, path: '', alias: 'item', items: null, error: null }
  }
  const path = String(scene.iterate)
  const alias = scene.iterateAs != null ? String(scene.iterateAs) : 'item'
  const res = lookupPath(projectScope, path)
  if (!res.found || !Array.isArray(res.value)) {
    return {
      active: true,
      path,
      alias,
      items: null,
      error: res.found
        ? `"${path}" is not an array`
        : `"${path}" is not a defined variable`,
    }
  }
  if (!isValidVarName(alias)) {
    return { active: true, path, alias, items: null, error: `Invalid alias "${alias}"` }
  }
  return { active: true, path, alias, items: res.value, error: null }
}

export interface ResolveNodeOptions {
  /**
   * Drop array items whose `condition` resolves falsy (orch walk.js
   * semantics). Unresolvable conditions keep the item (lenient preview).
   */
  prune?: boolean
}

/**
 * Deep display copy with every string resolved against `scope`. Template
 * keys keep their raw values (they are engine input, not content), `_id` is
 * preserved so editor identity survives.
 */
export function resolvePreviewNode<T>(
  node: T,
  scope: Scope,
  report?: PreviewReport,
  opts: ResolveNodeOptions = {}
): T {
  if (typeof node === 'string') {
    return resolvePreviewString(node, scope, report) as unknown as T
  }
  if (Array.isArray(node)) {
    const out: unknown[] = []
    for (const el of node) {
      if (
        opts.prune &&
        el &&
        typeof el === 'object' &&
        !Array.isArray(el) &&
        'condition' in (el as Record<string, unknown>)
      ) {
        const c = previewCondition((el as Record<string, unknown>).condition, scope)
        if (c.resolved && !c.shown) continue
      }
      out.push(resolvePreviewNode(el, scope, report, opts))
    }
    return out as unknown as T
  }
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.has(k)) continue
      out[k] = TEMPLATE_KEYS.has(k) ? v : resolvePreviewNode(v, scope, report, opts)
    }
    return out as unknown as T
  }
  return node
}

/** True when the value contains at least one syntactically valid placeholder. */
export function hasPlaceholder(value: unknown): boolean {
  if (typeof value !== 'string' || !value.includes('{{')) return false
  PLACEHOLDER_RE.lastIndex = 0
  for (const m of value.matchAll(PLACEHOLDER_RE)) {
    if (isValidPath(m[1].trim())) return true
  }
  return false
}

/** Deep scan: does any string in the node contain a placeholder? */
export function nodeHasPlaceholders(node: unknown): boolean {
  if (typeof node === 'string') return hasPlaceholder(node)
  if (Array.isArray(node)) return node.some(nodeHasPlaceholders)
  if (node && typeof node === 'object') {
    return Object.values(node).some(nodeHasPlaceholders)
  }
  return false
}

/**
 * Root variable names of every placeholder in the tree (orch's
 * collectPlaceholders): used for usage counts and default-coverage checks.
 */
export function collectPlaceholders(node: unknown): {
  roots: Map<string, number>
  invalid: Set<string>
} {
  const roots = new Map<string, number>()
  const invalid = new Set<string>()
  const visit = (n: unknown) => {
    if (typeof n === 'string') {
      PLACEHOLDER_RE.lastIndex = 0
      for (const m of n.matchAll(PLACEHOLDER_RE)) {
        const inner = m[1].trim()
        if (isValidPath(inner)) {
          const root = inner.split('.')[0]
          roots.set(root, (roots.get(root) ?? 0) + 1)
        } else {
          invalid.add(inner)
        }
      }
    } else if (Array.isArray(n)) {
      n.forEach(visit)
    } else if (n && typeof n === 'object') {
      Object.values(n).forEach(visit)
    }
  }
  visit(node)
  return { roots, invalid }
}

/** Preview safety cap — orch's plan-based cap is enforced at render time. */
const PREVIEW_MAX_ITERATE_ITEMS = 100

/**
 * Preview counterpart of orch iterate.js processScenes: expands iterate
 * scenes (ALL items), prunes condition-falsy scenes and array items,
 * substitutes strings — lenient throughout. Editor bookkeeping:
 * - clone `_id`s: first clone keeps the source `_id` (so scene-plan lookups
 *   during editing still resolve), later clones get `<id>~<index>`;
 * - every produced scene carries `_sourceId` for click-through mapping;
 * - an unresolvable iterate keeps ONE resolved copy so content stays
 *   visible while the scene settings show the error.
 */
export function resolveScenesForPreview(
  scenes: Record<string, any>[],
  projectScope: Scope
): Record<string, any>[] {
  const out: Record<string, any>[] = []

  scenes.forEach((scene, si) => {
    if (!scene || typeof scene !== 'object' || Array.isArray(scene)) {
      out.push(scene)
      return
    }
    const baseId =
      typeof scene.id === 'string' && scene.id ? scene.id : `scene-${si + 1}`
    const sceneScope = sceneScopeFor(scene, projectScope)

    if (scene.iterate == null) {
      const cond = previewCondition(scene.condition, sceneScope)
      if (cond.resolved && !cond.shown) return
      const copy = resolvePreviewNode(scene, sceneScope, undefined, { prune: true })
      copy._sourceId = scene._id
      out.push(copy)
      return
    }

    const it = previewIterate(scene, projectScope)
    if (!it.items || it.error) {
      // Broken iterate: show one copy (scene settings surface the error).
      const cond = previewCondition(scene.condition, sceneScope)
      if (cond.resolved && !cond.shown) return
      const copy = resolvePreviewNode(scene, sceneScope, undefined, { prune: true })
      copy._sourceId = scene._id
      out.push(copy)
      return
    }

    const items = it.items.slice(0, PREVIEW_MAX_ITERATE_ITEMS)
    items.forEach((item, idx) => {
      const itemScope = itemScopeFor(sceneScope, it.alias, item, idx)
      const cond = previewCondition(scene.condition, itemScope)
      if (cond.resolved && !cond.shown) return
      const clone = resolvePreviewNode(scene, itemScope, undefined, { prune: true })
      clone.id = `${baseId}-${idx}`
      clone._id = idx === 0 ? scene._id : `${scene._id}~${idx}`
      clone._sourceId = scene._id
      // audio elements are pooled by _id app-wide — clones need distinct ones
      if (idx > 0 && Array.isArray(clone.audios)) {
        clone.audios = clone.audios.map((a: any) =>
          a && typeof a === 'object' ? { ...a, _id: `${a._id}~${idx}` } : a
        )
      }
      // orch chains clones to each other; the last keeps the original target
      if (idx < items.length - 1 && clone.transition) {
        clone.transitionId = `${baseId}-${idx + 1}`
      }
      out.push(clone)
    })
  })

  // Re-point transitionIds that referenced an expanded scene id (orch parity).
  for (let i = 0; i < out.length - 1; i++) {
    const a = out[i]
    const b = out[i + 1]
    if (
      a &&
      typeof a === 'object' &&
      typeof a.transitionId === 'string' &&
      b &&
      typeof b === 'object' &&
      typeof b.id === 'string' &&
      a.transitionId !== b.id &&
      b.id.startsWith(`${a.transitionId}-`)
    ) {
      a.transitionId = b.id
    }
  }

  return out
}

/**
 * Quick scan: does this document use any template feature? Lets the preview
 * short-circuit to the raw doc for ordinary projects.
 */
export function hasTemplateMarkers(node: unknown): boolean {
  if (typeof node === 'string') return node.includes('{{')
  if (Array.isArray(node)) return node.some(hasTemplateMarkers)
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>
    if ('condition' in obj || 'iterate' in obj) return true
    return Object.values(obj).some(hasTemplateMarkers)
  }
  return false
}

/**
 * Full display resolution of an editor document: what orch's resolveProject
 * would produce, minus errors/stripping — for the full-movie preview and
 * the timeline. `variables` are the doc's defaults (editor keeps them in
 * `doc.extra.variables`). The returned object is a display copy; `extra`
 * (and therefore the raw variables) rides through untouched.
 */
export function resolveDocPreview<T extends Record<string, any>>(
  doc: T,
  variables: Record<string, unknown>
): T {
  const scope = buildProjectScope(variables)
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(doc)) {
    if (k === 'scenes' && Array.isArray(v)) {
      out.scenes = resolveScenesForPreview(v, scope)
    } else if (k === 'extra' || TEMPLATE_KEYS.has(k)) {
      out[k] = v
    } else {
      out[k] = resolvePreviewNode(v, scope, undefined, { prune: true })
    }
  }
  return out as T
}

/**
 * Root variable names referenced by scene `iterate` paths (raw dot-paths,
 * not placeholders — collectPlaceholders doesn't see them).
 */
export function collectIterateRoots(project: {
  scenes?: Record<string, any>[]
}): Map<string, number> {
  const roots = new Map<string, number>()
  for (const scene of project?.scenes ?? []) {
    if (scene?.iterate == null) continue
    const root = String(scene.iterate).split('.')[0]
    if (isValidVarName(root)) roots.set(root, (roots.get(root) ?? 0) + 1)
  }
  return roots
}

/**
 * JSON authors naturally write `"exitEnd": {{item.duration}},` — bare
 * placeholders are not valid JSON, so wrap every {{…}} that appears OUTSIDE
 * a string literal in quotes. String-aware scan; escapes handled.
 */
export function quoteBarePlaceholders(text: string): string {
  let out = ''
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      out += ch
      if (ch === '\\') {
        out += text[i + 1] ?? ''
        i++
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      continue
    }
    if (ch === '{' && text[i + 1] === '{') {
      const end = text.indexOf('}}', i + 2)
      if (end !== -1) {
        out += JSON.stringify(text.slice(i, end + 2))
        i = end + 1
        continue
      }
    }
    out += ch
  }
  return out
}

/** JSON.parse that forgives bare {{placeholders}} in value position. */
export function parseTemplateJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (err) {
    const fixed = quoteBarePlaceholders(text)
    if (fixed !== text) {
      try {
        return JSON.parse(fixed)
      } catch {
        throw err
      }
    }
    throw err
  }
}

export type VariableType = 'string' | 'number' | 'boolean' | 'array' | 'object' | 'null'

export function variableTypeOf(value: unknown): VariableType {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return 'array'
  const t = typeof value
  if (t === 'number' || t === 'boolean' || t === 'string') return t as VariableType
  return 'object'
}

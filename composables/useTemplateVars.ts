import { computed } from 'vue'
import { useProjectStore } from '~/stores/project'
import { useEditorStore } from '~/stores/editor'
import {
  buildProjectScope,
  sceneScopeFor,
  itemScopeFor,
  previewIterate,
  previewCondition,
  resolvePreviewNode,
  resolvePreviewString,
  nodeHasPlaceholders,
  variableTypeOf,
  isValidPath,
  lookupPath,
  PLACEHOLDER_RE,
  type Scope,
} from '~/shared/template/engine'

/** Expected resolved type for a field accepting template values. */
export type FieldKind = 'number' | 'string' | 'any'

export type TemplateValueCheck = { ok: true } | { ok: false; message: string }

/** Opacity multiplier for condition-falsy items in EDITING contexts (they
 *  stay selectable there; the full-movie preview drops them entirely). */
const CONDITION_OFF_DIM = 0.3
import type { SceneDoc, VisualDoc } from '~/shared/schema/types'

/**
 * Reactive bridge between the document's template variables and the preview
 * engine. All resolution here is display-only — the document always keeps
 * the raw {{placeholders}}.
 */
export function useTemplateVars() {
  const project = useProjectStore()
  const editor = useEditorStore()

  const variables = computed(() => project.variables)

  /** Project-level scope, rebuilt when variable defaults change. */
  const projectScope = computed<Scope>(() => buildProjectScope(variables.value))

  const previewOn = computed(() => editor.variablesPreview)

  /**
   * Scope a scene's content is previewed in: scene variables plus — for
   * iterate scenes — the FIRST item bound to the alias (the closest honest
   * preview of "one scene per item" without expanding the timeline).
   */
  function scenePreviewScope(scene: SceneDoc | Record<string, any>): Scope {
    const base = sceneScopeFor(scene as Record<string, any>, projectScope.value)
    const it = previewIterate(scene as Record<string, any>, projectScope.value)
    if (it.active && it.items && it.items.length > 0) {
      return itemScopeFor(base, it.alias, it.items[0], 0)
    }
    return base
  }

  /**
   * Display copy of a visuals list (no-op when preview is off or clean).
   * With `dimConditionOff`, items whose condition resolves falsy are dimmed
   * on the copy so they stay visible and selectable while editing.
   */
  function displayVisuals(
    items: VisualDoc[],
    scope: Scope,
    opts: { dimConditionOff?: boolean } = {}
  ): VisualDoc[] {
    if (!previewOn.value) return items
    return items.map((item) => {
      const needsResolve = nodeHasPlaceholders(item)
      const hasCondition = (item as any).condition !== undefined
      if (!needsResolve && !(opts.dimConditionOff && hasCondition)) return item
      const copy: any = needsResolve
        ? resolvePreviewNode(item, scope)
        : { ...(item as any) }
      if (opts.dimConditionOff && hasCondition) {
        const c = previewCondition((item as any).condition, scope)
        if (c.resolved && !c.shown) {
          copy.opacity = (copy.opacity ?? 1) * CONDITION_OFF_DIM
        }
      }
      return copy as VisualDoc
    })
  }

  /** Display value for a single string (background colors, srcs, …). */
  function displayString(value: string | undefined, scope?: Scope): string | undefined {
    if (!previewOn.value || typeof value !== 'string') return value
    const resolved = resolvePreviewString(value, scope ?? projectScope.value)
    return typeof resolved === 'string' ? resolved : String(resolved ?? '')
  }

  function conditionStateFor(node: Record<string, any>, scope?: Scope) {
    return previewCondition(node?.condition, scope ?? projectScope.value)
  }

  function iterateInfoFor(scene: SceneDoc | Record<string, any>) {
    return previewIterate(scene as Record<string, any>, projectScope.value)
  }

  function scopeFor(scene?: SceneDoc | Record<string, any> | null): Scope {
    return scene ? scenePreviewScope(scene) : projectScope.value
  }

  function kindMatches(kind: FieldKind, value: unknown): boolean {
    if (kind === 'any') return true
    return typeof value === kind
  }

  /**
   * Placeholder names offered by insert pickers: project variables, scene
   * variables, and — inside an iterate scene — the item alias (with the
   * first item's fields as dot-paths) plus `index`. With `kind` set, only
   * placeholders resolving to that type are offered.
   */
  function placeholderOptions(
    scene?: SceneDoc | Record<string, any> | null,
    kind: FieldKind = 'any'
  ): string[] {
    const scope = scopeFor(scene)
    const names: string[] = []
    const pushIfKind = (name: string) => {
      const res = lookupPath(scope, name)
      if (res.found && kindMatches(kind, res.value) && !names.includes(name)) {
        names.push(name)
      }
    }
    for (const n of Object.keys(variables.value)) pushIfKind(n)
    if (scene) {
      const sv = (scene as any).variables
      if (sv && typeof sv === 'object' && !Array.isArray(sv)) {
        for (const n of Object.keys(sv)) pushIfKind(n)
      }
      const it = previewIterate(scene as Record<string, any>, projectScope.value)
      if (it.active && !it.error && it.items) {
        const first = it.items[0]
        if (first && typeof first === 'object' && !Array.isArray(first)) {
          for (const key of Object.keys(first)) {
            if (kindMatches(kind, (first as Record<string, unknown>)[key])) {
              names.push(`${it.alias}.${key}`)
            }
          }
        } else if (kindMatches(kind, first)) {
          names.push(it.alias)
        }
        if (kind !== 'string') names.push('index')
      }
    }
    return names
  }

  /**
   * Strict entry validation for typed fields: every {{placeholder}} must be
   * a valid path that RESOLVES with the current defaults, and the resolved
   * type must fit the field. Returns a human message on failure — callers
   * reject the edit.
   */
  function validateTemplateValue(
    raw: string,
    kind: FieldKind,
    scene?: SceneDoc | Record<string, any> | null
  ): TemplateValueCheck {
    const scope = scopeFor(scene)
    PLACEHOLDER_RE.lastIndex = 0
    const matches = [...raw.matchAll(PLACEHOLDER_RE)]
    if (!matches.length) return { ok: true }

    for (const m of matches) {
      const inner = m[1].trim()
      if (!isValidPath(inner)) {
        return {
          ok: false,
          message: `Unsupported expression {{${inner}}} — only {{name}} or {{name.path}} placeholders work`,
        }
      }
      const res = lookupPath(scope, inner)
      if (!res.found) {
        return {
          ok: false,
          message: `{{${inner}}} is not defined — add it in the Variables panel first`,
        }
      }
    }

    const whole = matches.length === 1 && matches[0][0] === raw.trim()
    if (kind === 'number') {
      if (!whole) {
        return {
          ok: false,
          message:
            'Numeric fields need a single {{variable}} with no surrounding text',
        }
      }
      const value = lookupPath(scope, matches[0][1].trim()).value
      if (typeof value !== 'number') {
        return {
          ok: false,
          message: `{{${matches[0][1].trim()}}} is ${variableTypeOf(value)} — this field needs a number`,
        }
      }
    } else if (kind === 'string' && whole) {
      const value = lookupPath(scope, matches[0][1].trim()).value
      if (typeof value !== 'string') {
        return {
          ok: false,
          message: `{{${matches[0][1].trim()}}} is ${variableTypeOf(value)} — this field needs text`,
        }
      }
    }
    return { ok: true }
  }

  return {
    variables,
    projectScope,
    previewOn,
    scenePreviewScope,
    displayVisuals,
    displayString,
    conditionStateFor,
    iterateInfoFor,
    placeholderOptions,
    validateTemplateValue,
  }
}

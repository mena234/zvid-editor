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
  type Scope,
} from '~/shared/template/engine'

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

  return {
    variables,
    projectScope,
    previewOn,
    scenePreviewScope,
    displayVisuals,
    displayString,
    conditionStateFor,
    iterateInfoFor,
  }
}

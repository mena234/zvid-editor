import type { VisualDoc } from '~/shared/schema/types'
import { canonicalVisualType } from '~/shared/schema/types'

/** Short human label for a visual: text snippet, source file name, or type. */
export function visualLabel(item: VisualDoc, maxLen = 42): string {
  const type = canonicalVisualType(item.type)
  if (type === 'TEXT') {
    const t =
      (item as any).text ||
      (item as any).html?.replace(/<[^>]+>/g, ' ').trim() ||
      'text'
    return t.length > maxLen ? `${t.slice(0, maxLen)}…` : t
  }
  if (type === 'SVG') return (item as any).svg ? 'svg graphic' : 'svg'
  const src = (item as any).src ?? ''
  try {
    const url = new URL(src)
    const seg = url.pathname.split('/').filter(Boolean).pop()
    return seg || url.hostname
  } catch {
    return src.split(/[\\/]/).pop() || (type ?? 'element').toLowerCase()
  }
}

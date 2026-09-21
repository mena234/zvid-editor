import { extractFontFamilies, googleFontLinks, textFontStack } from './fonts'
import { fontSample, textFontHtml, textFontCss } from '../shared/textFontPolicy'
import { fitScriptSource } from './fitTextToBox'
import {
  TEXT_DEFAULT_FONT_FAMILY,
  TEXT_DEFAULT_FONT_SIZE,
} from '~/shared/schema/constants'
import { canonicalVisualType } from '~/shared/schema/types'

/**
 * TEXT visuals editable in place on the stage: only the plain DOM path.
 * customCode content renders in a sandboxed iframe or a shadow root, where a
 * contenteditable would edit generated markup, not the source text.
 */
export function isInlineEditableText(item: {
  type?: string
  customCode?: { css?: string | null; js?: string | null } | null
}): boolean {
  return (
    canonicalVisualType(item.type ?? '') === 'TEXT' &&
    !item.customCode?.css &&
    !item.customCode?.js
  )
}

/**
 * Plain TEXT whose box hugs the wrapped content: reflow edits (typing, a new
 * wrap width, typography changes) drop a declared height so the measured size
 * takes over, instead of letting the text overflow a stale box the renderer
 * would clip to. `fitToBox` is the opposite contract — the box is fixed and
 * the type shrinks into it — and customCode items lay themselves out.
 */
export function isAutoHugText(item: {
  type?: string
  customCode?: { css?: string | null; js?: string | null } | null
  fitToBox?: boolean
}): boolean {
  return isInlineEditableText(item) && item.fitToBox !== true
}

/**
 * Replicates package/src/lib/texts/buildHtmlContent.ts so the stage's TEXT
 * rendering (and the customCode iframe) match Puppeteer's capture page.
 */

export function styleObjectToCss(style: Record<string, any> | undefined): string {
  if (!style) return ''
  return Object.entries(style)
    .filter(([k]) => k !== 'fontFamily')
    .map(([key, value]) => {
      if (value === undefined || value === null) return ''
      const cssKey = key.replace(/([A-Z])/g, '-$1').toLowerCase()
      return `${cssKey}: ${value};`
    })
    .join('\n')
}

export interface TextTemplateOptions {
  html?: string
  text?: string
  svg?: string
  style?: Record<string, any>
  customCss?: string
  customJs?: string
  /** explicit container size (px) or fit-content */
  width?: number
  height?: number
  /** TEXT `fitToBox`: shrink typography until the glyphs fit the declared box */
  fitToBox?: boolean
}

/** Full HTML document for the sandboxed iframe (TEXT + SVG customCode). */
export function buildIframeDoc(opts: TextTemplateOptions): string {
  const fontFamily = opts.style?.fontFamily ?? TEXT_DEFAULT_FONT_FAMILY
  const style = { ...(opts.style ?? {}) }
  if (!style.fontSize && !opts.svg) style.fontSize = TEXT_DEFAULT_FONT_SIZE
  const cssProps = styleObjectToCss(style)
  const sample = fontSample(opts.text, opts.html)
  const body = opts.svg ?? (opts.html == null ? escapeHtml(opts.text ?? '') : textFontHtml(opts.html, sample))

  // The iframe is its own document: the document-level <link>s the stage
  // injects do not reach it, so every family the element references — style,
  // inline html, customCode css — needs its own link here.
  const fontLinks = googleFontLinks(
    extractFontFamilies({
      style: { ...style, fontFamily },
      html: opts.html,
      text: opts.text,
      css: opts.customCss,
    })
  )

  const fitBox = {
    width: typeof opts.width === 'number' && opts.width > 0 ? opts.width : null,
    height:
      typeof opts.height === 'number' && opts.height > 0 ? opts.height : null,
  }
  // Runs after customCode.js, like the renderer: the fit must see the DOM the
  // custom script produced.
  const fitScript =
    opts.fitToBox && (fitBox.width || fitBox.height)
      ? `<script>${fitScriptSource(fitBox)}<\/script>`
      : ''

  return `<!DOCTYPE html>
<html>
<head>
${fontLinks}
<style>
  * { margin: 0; padding: 0; box-sizing: content-box; background: transparent; }
  html, body { overflow: hidden; }
  .container {
    ${!opts.svg && opts.html == null ? 'white-space: pre-wrap;' : ''}
    font-family: ${textFontStack(fontFamily, fontSample(opts.text, opts.html))};
    ${cssProps}
    ${opts.width ? `width: ${opts.width}px;` : 'width: fit-content;'}
    ${opts.height ? `height: ${opts.height}px;` : ''}
  }
  ${opts.svg ? '.container svg { display:block; width:100%; height:100%; }' : ''}
  ${opts.svg ? opts.customCss ?? '' : textFontCss(opts.customCss ?? '', sample)}
</style>
</head>
<body>
<div class="container"${opts.svg ? '' : ' dir="auto"'}>${body}</div>
${opts.customJs ? `<script>try{${opts.customJs}}catch(e){console.error(e)}<\/script>` : ''}
${fitScript}
</body>
</html>`
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

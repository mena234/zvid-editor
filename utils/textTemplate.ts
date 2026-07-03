import { googleFontCssUrl } from './fonts'
import {
  TEXT_DEFAULT_FONT_FAMILY,
  TEXT_DEFAULT_FONT_SIZE,
} from '~/shared/schema/constants'

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
}

/** Full HTML document for the sandboxed iframe (TEXT + SVG customCode). */
export function buildIframeDoc(opts: TextTemplateOptions): string {
  const fontFamily = opts.style?.fontFamily ?? TEXT_DEFAULT_FONT_FAMILY
  const style = { ...(opts.style ?? {}) }
  if (!style.fontSize && !opts.svg) style.fontSize = TEXT_DEFAULT_FONT_SIZE
  const cssProps = styleObjectToCss(style)
  const body = opts.svg ?? opts.html ?? escapeHtml(opts.text ?? '')

  return `<!DOCTYPE html>
<html>
<head>
<link rel="stylesheet" href="${googleFontCssUrl(fontFamily)}">
<style>
  * { margin: 0; padding: 0; box-sizing: content-box; background: transparent; }
  html, body { overflow: hidden; }
  .container {
    font-family: '${fontFamily}', sans-serif;
    ${cssProps}
    ${opts.width ? `width: ${opts.width}px;` : 'width: fit-content;'}
    ${opts.height ? `height: ${opts.height}px;` : ''}
  }
  ${opts.svg ? '.container svg { display:block; width:100%; height:100%; }' : ''}
  ${opts.customCss ?? ''}
</style>
</head>
<body>
<div class="container">${body}</div>
${opts.customJs ? `<script>try{${opts.customJs}}catch(e){console.error(e)}<\/script>` : ''}
</body>
</html>`
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

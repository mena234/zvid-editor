import {
  parseFontFamilies,
  resolveFontFamilies,
} from './fontResolution';

/** Mirrored in package/src/lib/texts/fontPolicy.ts. Limit authored fonts, never script coverage. */
export const MAX_FAMILIES_PER_ELEMENT = 4;
export function textFontStack(stack: string, text: string): string {
  const families = text.trim()
    ? resolveFontFamilies(stack, text)
    : parseFontFamilies(stack);
  const generic =
    String(stack)
      .split(',')
      .map((s) => s.trim())
      .find((s) =>
        /^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/i.test(s)
      ) || 'sans-serif';
  return [
    ...families.map(
      (f) =>
        `'${f
          .replace(/[<>{}\r\n]/g, '')
          .replace(/\\/g, '\\\\')
          .replace(/'/g, "\\'")}'`
    ),
    generic,
  ].join(', ');
}

/** Text used only to choose script fallbacks, never to replace authored content. */
export function fontSample(text?: string | null, html?: string | null): string {
  if (!html) return text || '';
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&#(x[0-9a-f]+|\d+);?/gi, (_, code) => {
      const value =
        code[0].toLowerCase() === 'x'
          ? parseInt(code.slice(1), 16)
          : Number(code);
      return value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : '';
    });
}

export function referencedTextFamilies(
  stack: string,
  text: string,
  ...sources: (string | undefined | null)[]
): string[] {
  const authored = parseFontFamilies(stack);
  for (const source of sources) {
    for (const match of (source || '').matchAll(
      /font-family\s*:\s*((?:(?:"[^"]*"|'[^']*')|[^;"'{}<>])+)/gi
    )) {
      const declared = match[1].replace(/\s*!important\s*$/i, '').trim();
      if (!/\b(?:var|env)\s*\(|^(?:inherit|initial|unset|revert|revert-layer)$/i.test(declared))
        authored.push(...parseFontFamilies(declared));
    }
  }
  const unique = authored
    .filter(
      (family, index) =>
        authored.findIndex((f) => f.toLowerCase() === family.toLowerCase()) ===
        index
    )
    .slice(0, MAX_FAMILIES_PER_ELEMENT);
  return text.trim() ? resolveFontFamilies(unique.join(', '), text) : unique;
}

/** The same bounded retry sequence is used in document, iframe and render CSS. */
export function textFontCssUrls(family: string): string[] {
  const base = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family.trim()).replace(/%20/g, '+')}`;
  return [
    `${base}:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,400;1,700&display=swap`,
    `${base}:wght@300;400;500;600;700;800;900&display=swap`,
    `${base}&display=swap`,
  ];
}

/** Extend static declarations without freezing CSS variables or inheritance. */
export function textFontCss(css: string, text: string): string {
  if (!text.trim()) return css;
  return css.replace(
    /(\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|@font-face\s*\{[^}]*\})|((?<![\w-])font-family\s*:\s*)((?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^;{}"'])+)/gi,
    (original, protectedToken, declaration, value, offset) => {
      if (protectedToken) return original;
      const before = css.slice(0, offset).replace(/\/\*[\s\S]*?\*\//g, '').trimEnd();
      if (before && !/[;{]$/.test(before)) return original;
      const important = value.match(/\s*!important\s*$/i)?.[0] || '';
      const stack = value.slice(0, value.length - important.length).trim();
      // A small declaration transformer is not a complete CSS parser. Keep
      // escaped/commented syntax intact rather than changing authored meaning.
      if (/\\|\/\*/.test(stack)) return original;
      if (/\b(?:var|env)\s*\(|^(?:inherit|initial|unset|revert|revert-layer)$/i.test(stack))
        return original;
      return declaration + textFontStack(stack, text) + important;
    }
  );
}

/** Rewrite only CSS in markup; source text and other attributes stay intact. */
export function textFontHtml(html: string, text = fontSample(undefined, html)): string {
  return html
    .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi,
      (_, open, css, close) => open + textFontCss(css, text) + close)
    .replace(/<[a-z][a-z\d:-]*(?:[^>"']|"[^"]*"|'[^']*')*>/gi, tag =>
      tag.replace(/(\sstyle\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
        (original, prefix, doubleQuoted, singleQuoted, bare) => {
          const rawCss = doubleQuoted ?? singleQuoted ?? bare;
          // Preserve unfamiliar HTML entities exactly. Decoding/re-encoding a
          // partial entity set can change unrelated CSS values or URLs.
          if (/&(?!(?:amp|quot|apos|#34|#39);)/i.test(rawCss)) return original;
          const css = rawCss
            .replace(/&quot;|&#34;/gi, '"').replace(/&apos;|&#39;/gi, "'").replace(/&amp;/gi, '&');
          const transformed = textFontCss(css, text);
          if (transformed === css) return original;
          // Attribute encoding avoids changing the tag's structure regardless
          // of the quote style used by an authored font name.
          return prefix + '"' + transformed.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"';
        }))
}

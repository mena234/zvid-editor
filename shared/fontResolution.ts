/** Keep in sync with editor/shared/fontResolution.ts. */
export interface FontVariant {
  weight: number;
  italic: boolean;
}

const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'math',
  'emoji',
  'fangsong',
  'inherit',
  'initial',
  'unset',
  'revert',
  'revert-layer',
]);

/** Real families from a CSS stack, unquoted and deduplicated in authored order. */
export function parseFontFamilies(stack: string): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const part of String(stack || '').split(',')) {
    const family = part
      .trim()
      .replace(/^(["'])(.*)\1$/, '$2')
      .trim();
    const key = family.toLowerCase();
    if (
      !family ||
      GENERIC_FAMILIES.has(key) ||
      family.startsWith('var(') ||
      seen.has(key)
    )
      continue;
    seen.add(key);
    result.push(family);
  }
  return result;
}

const SCRIPT_FONTS: Array<[RegExp, string]> = [
  [/\p{Script=Arabic}/u, 'Noto Sans Arabic'],
  [/\p{Script=Hebrew}/u, 'Noto Sans Hebrew'],
  [/\p{Script=Devanagari}/u, 'Noto Sans Devanagari'],
  [/\p{Script=Bengali}/u, 'Noto Sans Bengali'],
  [/\p{Script=Gurmukhi}/u, 'Noto Sans Gurmukhi'],
  [/\p{Script=Gujarati}/u, 'Noto Sans Gujarati'],
  [/\p{Script=Oriya}/u, 'Noto Sans Oriya'],
  [/\p{Script=Tamil}/u, 'Noto Sans Tamil'],
  [/\p{Script=Telugu}/u, 'Noto Sans Telugu'],
  [/\p{Script=Kannada}/u, 'Noto Sans Kannada'],
  [/\p{Script=Malayalam}/u, 'Noto Sans Malayalam'],
  [/\p{Script=Sinhala}/u, 'Noto Sans Sinhala'],
  [/\p{Script=Thai}/u, 'Noto Sans Thai'],
  [/\p{Script=Khmer}/u, 'Noto Sans Khmer'],
  [/\p{Script=Myanmar}/u, 'Noto Sans Myanmar'],
  [/\p{Script=Lao}/u, 'Noto Sans Lao'],
  [/\p{Script=Ethiopic}/u, 'Noto Sans Ethiopic'],
  [/\p{Script=Armenian}/u, 'Noto Sans Armenian'],
  [/\p{Script=Georgian}/u, 'Noto Sans Georgian'],
];

/** Downloaded, cross-platform fallbacks; never depend on the host OS font set. */
export function scriptFallbackFamilies(text: string): string[] {
  const value = String(text || '');
  const families = SCRIPT_FONTS.filter(([script]) => script.test(value)).map(
    ([, family]) => family
  );
  // Kana and Hangul disambiguate Han glyph conventions in Japanese/Korean text.
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value))
    families.push('Noto Sans JP');
  if (/\p{Script=Hangul}/u.test(value)) families.push('Noto Sans KR');
  if (
    /\p{Script=Han}/u.test(value) &&
    !families.some((f) => f === 'Noto Sans JP' || f === 'Noto Sans KR')
  )
    families.push('Noto Sans SC');
  if (/[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(value)) {
    families.push('Noto Emoji');
  }
  families.push('Noto Sans');
  return families;
}

export function resolveFontFamilies(stack: string, text: string): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const family of [
    ...parseFontFamilies(stack),
    ...scriptFallbackFamilies(text),
  ]) {
    const key = family.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(family);
    }
  }
  return result;
}

/** Missing italics use the upright face and the same synthetic styling in libass. */
export function fontVariantCandidates(
  variant: Partial<FontVariant> = {}
): FontVariant[] {
  const weight = Math.min(900, Math.max(100, Number(variant.weight) || 400));
  const italic = !!variant.italic;
  const result = [{ weight, italic }];
  if (italic) result.push({ weight, italic: false });
  if (weight !== 400) result.push({ weight: 400, italic: false });
  return result;
}

/** Read Unicode cmap format 4/12 rather than assuming a font covers its script. */
export function fontCoversText(
  data: ArrayBuffer | Uint8Array,
  text: string
): boolean {
  try {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let cmap = -1;
    for (let i = 0; i < view.getUint16(4); i++) {
      const entry = 12 + i * 16;
      if (view.getUint32(entry) === 0x636d6170) {
        cmap = view.getUint32(entry + 8);
        break;
      }
    }
    if (cmap < 0) return false;
    const subtables: number[] = [];
    for (let i = 0; i < view.getUint16(cmap + 2); i++) {
      const entry = cmap + 4 + i * 8;
      const platform = view.getUint16(entry);
      const encoding = view.getUint16(entry + 2);
      if (
        platform !== 0 &&
        !(platform === 3 && (encoding === 1 || encoding === 10))
      )
        continue;
      const offset = cmap + view.getUint32(entry + 4);
      if ([4, 12].includes(view.getUint16(offset))) subtables.push(offset);
    }
    const has = (code: number) =>
      subtables.some((offset) => {
        if (view.getUint16(offset) === 12) {
          let lo = 0,
            hi = view.getUint32(offset + 12) - 1;
          while (lo <= hi) {
            const mid = (lo + hi) >>> 1;
            const group = offset + 16 + mid * 12;
            const start = view.getUint32(group),
              end = view.getUint32(group + 4);
            if (code < start) hi = mid - 1;
            else if (code > end) lo = mid + 1;
            else return view.getUint32(group + 8) + code - start !== 0;
          }
          return false;
        }
        if (code > 0xffff) return false;
        const count = view.getUint16(offset + 6) / 2;
        const ends = offset + 14,
          starts = ends + count * 2 + 2;
        const deltas = starts + count * 2,
          ranges = deltas + count * 2;
        for (let i = 0; i < count; i++) {
          if (code > view.getUint16(ends + i * 2)) continue;
          if (code < view.getUint16(starts + i * 2)) return false;
          const delta = view.getInt16(deltas + i * 2);
          const range = view.getUint16(ranges + i * 2);
          if (!range) return ((code + delta) & 0xffff) !== 0;
          const glyph = view.getUint16(
            ranges + i * 2 + range + (code - view.getUint16(starts + i * 2)) * 2
          );
          return glyph !== 0 && ((glyph + delta) & 0xffff) !== 0;
        }
        return false;
      });
    // Whitespace, join controls and variation selectors have no visible glyph.
    return [...String(text || '')].every(
      (ch) => /[\s\p{Cf}\uFE00-\uFE0F]/u.test(ch) || has(ch.codePointAt(0)!)
    );
  } catch {
    return false;
  }
}

/** Resolve to actual supplied glyphs before generating styles/measurements. */
export async function resolveSubtitleFonts<
  T extends { family: string; data: Uint8Array },
>(
  stack: string,
  text: string,
  load: (family: string) => Promise<T | null>
): Promise<{ family: string; fonts: T[] }> {
  const fonts: T[] = [];
  for (const family of resolveFontFamilies(stack, text)) {
    const font = await load(family);
    if (!font) continue;
    fonts.push(font);
    // Use one real covering face where possible, so libass never asks the
    // operating system for an arbitrary substitute for the requested face.
    if (fontCoversText(font.data, text)) return { family: font.family, fonts };
  }
  const chars = [...text].filter((ch) => !/[\s\p{Cf}\uFE00-\uFE0F]/u.test(ch));
  if (
    !fonts.length ||
    chars.some((ch) => !fonts.some((font) => fontCoversText(font.data, ch)))
  ) {
    throw new Error(
      'Subtitle fonts could not be loaded with all required characters. Please retry or choose a font for this language.'
    );
  }
  // A genuinely mixed-script caption can need several faces; all are supplied
  // to libass, including the requested primary, rather than relying on the OS.
  return { family: fonts[0].family, fonts };
}

/** Pin mixed-script fallback runs to the same supplied face on every platform. */
export function applyAssFontFallbacks(
  content: string,
  primary: string,
  fonts: Array<{ family: string; data: Uint8Array }>
): string {
  if (fonts.length < 2) return content;
  const segmenter = new (Intl as any).Segmenter(undefined, {
    granularity: 'grapheme',
  });
  const primaryFont = fonts.find((font) => font.family === primary);
  return content
    .split('\n')
    .map((line) => {
      if (!line.startsWith('Dialogue:')) return line;
      let start = 0;
      for (let i = 0; i < 9; i++) start = line.indexOf(',', start) + 1;
      if (!start) return line;
      const text = line.slice(start);
      // Normal single-script captions retain byte-identical ASS, including their
      // existing animation tags. This pass only supplies otherwise missing glyphs.
      const visible = text
        .replace(/\{[^}]*\}/g, '')
        .replace(/\\[Nnh]/g, ' ')
        .replace(/\\([{}])/g, '$1');
      if (primaryFont && fontCoversText(primaryFont.data, visible)) return line;
      let active = primaryFont;
      let lastTextFont = primaryFont;
      let drawing = false;
      let output = '';
      for (let cursor = 0; cursor < text.length; ) {
        if (text[cursor] === '{') {
          const end = text.indexOf('}', cursor);
          if (end >= 0) {
            const tag = text.slice(cursor, end + 1);
            if (/\\r(?:[^\\}]*)/.test(tag)) active = primaryFont;
            for (const match of tag.matchAll(/\\p(\d+)/g))
              drawing = Number(match[1]) > 0;
            output += tag;
            cursor = end + 1;
            continue;
          }
        }
        if (text[cursor] === '\\' && /[Nnh{}]/.test(text[cursor + 1] ?? '')) {
          output += text.slice(cursor, cursor + 2);
          cursor += 2;
          continue;
        }
        let end = cursor + 1;
        while (end < text.length && text[end] !== '{' && text[end] !== '\\')
          end++;
        const run = text.slice(cursor, end);
        if (drawing) output += run;
        else
          for (const { segment } of segmenter.segment(run)) {
            const neutral =
              /^[\p{Script=Common}\p{Script=Inherited}\p{Cf}\s]+$/u.test(
                segment
              );
            const font =
              neutral &&
              lastTextFont &&
              fontCoversText(lastTextFont.data, segment)
                ? lastTextFont
                : fonts.find((candidate) =>
                    fontCoversText(candidate.data, segment)
                  );
            if (font && font.family !== active?.family) {
              output += `{\\fn${font.family}}`;
              active = font;
            }
            if (font) lastTextFont = font;
            output += segment;
          }
        cursor = end;
      }
      return line.slice(0, start) + output;
    })
    .join('\n');
}

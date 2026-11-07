/** Mirrored in editor/shared/fontMetrics.ts. Keep browser and render metrics identical. */
export type FontLineMetrics = {
  ascent: number;
  descent: number;
  lineGap: number;
};

/**
 * Google Fonts' server-requested faces are SFNT (TrueType/OpenType). Explicit
 * metrics prevent Chromium's platform font backend from choosing a different
 * table. Use the font's requested typo metrics, otherwise Windows metrics,
 * preserving the existing Windows editor layout. Unsupported/corrupt files
 * retain their original CSS rather than producing invalid overrides.
 */
export function fontLineMetrics(bytes: Uint8Array): FontLineMetrics | null {
  if (bytes.byteLength < 12) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = view.getUint32(0);
  if (signature !== 0x00010000 && signature !== 0x4f54544f) return null;
  const count = view.getUint16(4);
  if (12 + count * 16 > bytes.byteLength) return null;
  const tables = new Map<number, { offset: number; length: number }>();
  for (let i = 0; i < count; i++) {
    const p = 12 + i * 16;
    const offset = view.getUint32(p + 8),
      length = view.getUint32(p + 12);
    if (offset + length > bytes.byteLength) return null;
    tables.set(view.getUint32(p), { offset, length });
  }
  const head = tables.get(0x68656164),
    os2 = tables.get(0x4f532f32),
    hhea = tables.get(0x68686561);
  if (!head || head.length < 20) return null;
  const units = view.getUint16(head.offset + 18);
  if (units < 16 || units > 16384) return null;
  let ascent: number, descent: number, lineGap: number;
  if (os2 && os2.length >= 78) {
    const o = os2.offset;
    if (view.getUint16(o + 62) & 0x80) {
      ascent = view.getInt16(o + 68);
      descent = -view.getInt16(o + 70);
      lineGap = view.getInt16(o + 72);
    } else {
      ascent = view.getUint16(o + 74);
      descent = view.getUint16(o + 76);
      lineGap = 0;
    }
  } else if (hhea && hhea.length >= 10) {
    ascent = view.getInt16(hhea.offset + 4);
    descent = -view.getInt16(hhea.offset + 6);
    lineGap = view.getInt16(hhea.offset + 8);
  } else return null;
  if (ascent <= 0 || descent < 0 || lineGap < 0) return null;
  const percent = (value: number) => Number(((100 * value) / units).toFixed(8));
  return {
    ascent: percent(ascent),
    descent: percent(descent),
    lineGap: percent(lineGap),
  };
}

/** Normalize downloaded faces only. Authored CSS/line-height is not rewritten. */
export async function normalizeFontFaceMetrics(
  css: string,
  loadFont: (url: string) => Promise<Uint8Array>
): Promise<string> {
  const faces = [...css.matchAll(/@font-face\s*\{[^}]*\}/gi)];
  const pending = new Map<string, Promise<FontLineMetrics | null>>();
  const replacements = await Promise.all(
    faces.map(async ([face]) => {
      if (/\b(?:ascent|descent|line-gap)-override\s*:/i.test(face)) return face;
      const src = face.match(
        /\bsrc\s*:\s*url\(\s*(['"]?)(https:[^)'"\s]+)\1\s*\)/i
      )?.[2];
      if (!src) return face;
      try {
        if (new URL(src).origin !== 'https://fonts.gstatic.com') return face;
      } catch {
        return face;
      }
      let metrics = pending.get(src);
      if (!metrics) {
        // Propagate network failures so callers retry and never cache an
        // apparently successful stylesheet with missing metric corrections.
        metrics = loadFont(src).then(fontLineMetrics);
        pending.set(src, metrics);
      }
      const m = await metrics;
      if (!m) return face;
      return face.replace(
        /\s*}$/,
        `;ascent-override:${m.ascent}%;descent-override:${m.descent}%;line-gap-override:${m.lineGap}%;}`
      );
    })
  );
  let i = 0;
  return css.replace(/@font-face\s*\{[^}]*\}/gi, () => replacements[i++]);
}

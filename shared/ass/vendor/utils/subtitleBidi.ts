// bidi-js implements UAX #9 and ships JavaScript without declarations.
// @ts-expect-error No bundled types in bidi-js 1.0.3.
import bidiFactory from 'bidi-js';
import type { SubtitleMeasure } from './subtitleFontMetrics';

const bidi = bidiFactory() as {
  getEmbeddingLevels(text: string): {
    levels: Uint8Array;
    paragraphs: unknown[];
  };
  getReorderedIndices(
    text: string,
    levels: unknown,
    start?: number,
    end?: number
  ): number[];
};

export interface WordSpan {
  left: number;
  width: number;
  direction: 'ltr' | 'rtl';
  logicalStart: number;
}

export function hasRtlText(text: string): boolean {
  return bidi
    .getEmbeddingLevels(text)
    .levels.some((level) => (level & 1) === 1);
}

/**
 * Measure logical word spans in visual order. The actual text always remains
 * logical Unicode for libass/HarfBuzz; only the background rectangles reorder.
 * Mixed-direction words can occupy multiple visual fragments, so never cover
 * intervening words with a single bounding rectangle.
 */
export function visualWordSpans(
  texts: string[],
  separators: string[],
  measure: SubtitleMeasure,
  context?: { text: string; start: number; splitDirections?: boolean }
): WordSpan[][] {
  let text = '';
  const owners: number[] = [];
  texts.forEach((word, i) => {
    const gap = separators[i] ?? (i ? ' ' : '');
    text += gap;
    owners.push(...Array(gap.length).fill(-1));
    text += word;
    owners.push(...Array(word.length).fill(i));
  });
  const suffix = separators[texts.length] ?? '';
  text += suffix;
  owners.push(...Array(suffix.length).fill(-1));
  const paragraph = context?.text ?? text;
  const start = context?.start ?? 0;
  const embedding = bidi.getEmbeddingLevels(paragraph);
  const indices = bidi
    .getReorderedIndices(paragraph, embedding, start, start + text.length - 1)
    .slice(start, start + text.length)
    .map((index) => index - start);
  const fragments: {
    owner: number;
    direction: 'ltr' | 'rtl';
    indices: number[];
  }[] = [];
  for (const index of indices) {
    const owner = owners[index];
    const direction = embedding.levels[start + index] & 1 ? 'rtl' : 'ltr';
    const last = fragments[fragments.length - 1];
    if (
      last &&
      last.owner === owner &&
      (!context?.splitDirections || last.direction === direction)
    )
      last.indices.push(index);
    else fragments.push({ owner, direction, indices: [index] });
  }
  const widths = fragments.map((fragment) => {
    const logical = fragment.indices.slice().sort((a, b) => a - b);
    return measure.range
      ? measure.range(text, logical[0], logical[logical.length - 1] + 1)
      : measure(logical.map((index) => text[index]).join(''));
  });
  // Shape whole words (not letters), preserving Arabic joins and Indic marks.
  // Account for small cross-boundary kerning differences against the full line.
  const total = widths.reduce((sum, width) => sum + width, 0);
  const scale = total > 0 ? measure(text) / total : 1;
  const spans: WordSpan[][] = texts.map(() => []);
  let left = 0;
  fragments.forEach((fragment, i) => {
    const width = widths[i] * scale;
    if (fragment.owner >= 0)
      spans[fragment.owner].push({
        left,
        width,
        direction: fragment.direction,
        logicalStart: Math.min(...fragment.indices),
      });
    left += width;
  });
  return spans;
}

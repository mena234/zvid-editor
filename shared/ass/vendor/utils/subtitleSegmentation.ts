/** Keep identical to the editor vendor copy: pinned ICU4X, never host ICU. */
interface BoundaryIterator {
  next(): number;
  readonly isWordLike?: boolean;
}
interface BoundarySegmenter {
  segment(input: string): BoundaryIterator;
}
export interface SubtitleSegmentationProvider {
  WordSegmenter: { createDictionary(): BoundarySegmenter };
  GraphemeClusterSegmenter: new () => BoundarySegmenter;
}
export interface SubtitleWordSegment {
  segment: string;
  index: number;
  isWordLike: boolean;
}

let words: BoundarySegmenter | undefined;
let characters: BoundarySegmenter | undefined;

export function configureSubtitleSegmentation(provider: SubtitleSegmentationProvider): void {
  if (words && characters) return;
  words = provider.WordSegmenter.createDictionary();
  characters = new provider.GraphemeClusterSegmenter();
}

function requireSegmenter(segmenter: BoundarySegmenter | undefined): BoundarySegmenter {
  if (!segmenter) throw new Error('Subtitle language support has not loaded. Reload the editor or retry the render.');
  return segmenter;
}

export function segmentTextWords(text: string): SubtitleWordSegment[] {
  const iterator = requireSegmenter(words).segment(String(text));
  const result: SubtitleWordSegment[] = [];
  let previous = 0;
  for (let end = iterator.next(); end >= 0; end = iterator.next()) {
    if (end > previous) result.push({
      segment: text.slice(previous, end),
      index: previous,
      isWordLike: !!iterator.isWordLike,
    });
    previous = end;
  }
  return result;
}

export function segmentTextGraphemes(text: string): string[] {
  const iterator = requireSegmenter(characters).segment(String(text));
  const result: string[] = [];
  let previous = 0;
  for (let end = iterator.next(); end >= 0; end = iterator.next()) {
    if (end > previous) result.push(text.slice(previous, end));
    previous = end;
  }
  return result;
}

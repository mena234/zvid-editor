/** Unicode-aware subtitle tokenization, shared verbatim with the editor. */
import { segmentTextWords, segmentTextGraphemes } from './subtitleSegmentation';

export function graphemes(text: string): string[] {
  return segmentTextGraphemes(text);
}

/** Keep punctuation attached to its word and whitespace in the source text. */
export function segmentWords(text: string): string[] {
  const words: string[] = [];
  let pending = '';
  let separated = true;
  for (const part of segmentTextWords(text)) {
    if (/^\s+$/u.test(part.segment)) {
      if (pending) {
        words.push(pending);
        pending = '';
      }
      separated = true;
    } else if (part.isWordLike) {
      words.push(pending + part.segment);
      pending = '';
      separated = false;
    } else if (!separated && words.length) {
      words[words.length - 1] += part.segment;
    } else {
      pending += part.segment;
    }
  }
  if (pending) words.push(pending);
  return words;
}

type CaptionText = { text?: string; words?: readonly { text: string }[] };

/** Recover original separators from caption.text without adding wire fields. */
export function captionSeparators(caption: CaptionText): string[] {
  const words = caption.words ?? [];
  const source = String(caption.text ?? '');
  let cursor = 0;
  let matched = !!source;
  const separators = words.map((word, i) => {
    const at = source.indexOf(word.text, cursor);
    if (at < cursor || !word.text) {
      matched = false;
      return i ? ' ' : '';
    }
    const separator = source.slice(cursor, at);
    cursor = at + word.text.length;
    return separator;
  });
  if (matched) return [...separators, source.slice(cursor)];
  // Word-only input has no source separators. Preserve explicit whitespace;
  // otherwise use no gap for scripts normally written without word spaces.
  const unspaced =
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
  return [
    ...words.map((word, i) =>
      !i || /^\s/u.test(word.text) || /\s$/u.test(words[i - 1].text)
        ? ''
        : unspaced.test(words[i - 1].text + word.text)
          ? ''
          : ' '
    ),
    '',
  ];
}

export function joinCaptionWords(
  caption: CaptionText,
  render: (word: { text: string }, index: number) => string = (word) =>
    word.text,
  start = 0,
  end = caption.words?.length ?? 0
): string {
  const separators = captionSeparators(caption);
  return (
    (caption.words ?? [])
      .slice(start, end)
      .map(
        (word, i) =>
          `${i || !start ? separators[start + i] : separators[start + i].trimStart()}${render(word, start + i)}`
      )
      .join('') +
    (end >= (caption.words?.length ?? 0)
      ? (separators[caption.words?.length ?? 0] ?? '')
      : '')
  );
}

// `import type` (not a value import): Vite/esbuild does not elide type-only
// named imports the way tsc does — a value import of types breaks in-browser.
import type { Caption, Word } from '../types/text';

type TextCase = 'capitalize' | 'lowercase' | 'uppercase' | undefined;

// Helper function to format time in ASS format (h:mm:ss.cs).
// Delegates to formatTime so both formatters share one rounding/clamping policy.
export function formatASSTime(seconds: number): string {
  return formatTime(seconds);
}

/**
 * Escape user text for an ASS Dialogue line: `{`/`}` open override blocks and
 * raw newlines split the event; `\N` is the ASS hard line break.
 */
export function escapeAssText(text: unknown): string {
  return String(text ?? '')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r?\n/g, '\\N');
}

function applyTextCaseToString(input: string, textCase?: TextCase): string {
  switch (textCase) {
    case 'capitalize':
      return input
        .split(' ')
        .map((w) => (w ? w.charAt(0).toLocaleUpperCase() + w.slice(1) : w))
        .join(' ');
    case 'lowercase':
      return input.toLocaleLowerCase();
    case 'uppercase':
      return input.toLocaleUpperCase();
    default:
      return input;
  }
}

function applyTextCaseToWord(wordText: string, textCase?: TextCase): string {
  switch (textCase) {
    case 'capitalize':
      return wordText
        ? wordText.charAt(0).toLocaleUpperCase() + wordText.slice(1)
        : wordText;
    case 'lowercase':
      return wordText.toLocaleLowerCase();
    case 'uppercase':
      return wordText.toLocaleUpperCase();
    default:
      return wordText;
  }
}

/**
 * Mutates caption.words in-place (same Word object references).
 * Also returns the transformed full text (and optionally you can assign caption.text).
 */
export function transformTextCase(
  caption: Caption,
  textCase?: TextCase
): string {
  let text = caption.text;

  // Build text from words if caption.text missing/empty
  if (!text || !text.trim()) {
    text = (caption.words ?? [])
      .slice()
      .sort((a: Word, b: Word) => a.start - b.start)
      .map((w) => w.text)
      .join(' ');
  }

  // Transform caption.text (caller can assign it if desired)
  const transformedText = applyTextCaseToString(text, textCase);

  // Mutate words in-place (keep same references)
  if (caption.words?.length) {
    for (const w of caption.words) {
      w.text = applyTextCaseToWord(w.text, textCase);
    }
  }

  return transformedText;
}

/**
 * Distribute word timings across a caption window proportionally to word
 * length (+1 for the trailing space), for captions supplied without `words`.
 * Mirrors the editor's distributeWords so preview and render agree.
 */
export function distributeWords(
  text: string,
  start: number,
  end: number
): Word[] {
  const parts = String(text ?? '')
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length || !(end > start)) return [];
  const total = end - start;
  const weightSum = parts.reduce((s, w) => s + w.length + 1, 0);
  let t = start;
  return parts.map((w) => {
    const dur = ((w.length + 1) / weightSum) * total;
    const word = {
      start: Math.round(t * 1000) / 1000,
      end: Math.round((t + dur) * 1000) / 1000,
      text: w,
    };
    t += dur;
    return word;
  });
}

// ASS time format: h:mm:ss.cc (centiseconds)
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    seconds = 0;
  }

  const totalCentiseconds = Math.round(seconds * 100);
  const cs = totalCentiseconds % 100;
  const totalSeconds = (totalCentiseconds - cs) / 100;

  const s = totalSeconds % 60;
  const totalMinutes = (totalSeconds - s) / 60;
  const m = totalMinutes % 60;
  const h = (totalMinutes - m) / 60;

  const pad2 = (n: number) => String(n).padStart(2, '0');

  return `${h}:${pad2(m)}:${pad2(s)}.${pad2(cs)}`;
}

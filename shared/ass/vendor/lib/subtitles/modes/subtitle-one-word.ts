import { escapeAssText, formatTime } from '../../../utils/subtitles';
import type { Subtitle, SubtitleStyles, Word } from '../../../types/text';
// Extract and flatten words from SubtitleJSON.subtitle.data
function extractWordsFromSubtitle(jsonData: Subtitle): Word[] {
  const words: Word[] = [];

  for (let i = 0; i < jsonData.captions.length; i++) {
    const caption = jsonData.captions[i];
    // Captions without word-level timing (valid for "normal" mode data)
    // simply contribute nothing in a word-based mode.
    const wordsInCaption = caption.words ?? [];
    words.push(...wordsInCaption);
  }
  // Sort by start time (st) just to be safe
  words.sort((a, b) => a.start - b.start);

  return words;
}

// Function to generate ASS content (word-by-word highlight)
export function generateASSContent(jsonData: Subtitle) {
  const words = extractWordsFromSubtitle(jsonData);
  const { marginV, marginH } = jsonData.styles as SubtitleStyles;

  let assContent = ``;

  words.forEach((word: Word) => {
    const startSeconds = word.start;
    const endSeconds = word.end;

    const start = formatTime(startSeconds);
    const end = formatTime(endSeconds);

    const text = `{\\rHighlight}${escapeAssText(word.text)}{\\rDefault}`;

    assContent += `Dialogue: 0,${start},${end},Default,,${marginH},${marginH},${marginV},,${text}\n`;
  });

  return assContent;
}

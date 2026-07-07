import { escapeAssText, formatTime } from '../../../utils/subtitles';
import type { SubtitleStyles, Subtitle } from '../../../types/text';

// Generate ASS content
export function generateASSContent(subtitle: Subtitle) {
  const styles = subtitle.styles as SubtitleStyles;
  const groups = subtitle.captions
    .map((caption) => caption.words ?? [])
    .filter((group) => group.length > 0);
  let assContent = ``;

  groups.forEach((group, groupIndex) => {
    assContent += `; Group ${groupIndex + 1}: "${group.map((w) => w.text).join(' ')}"\n`;

    const groupEnd = group[group.length - 1].end;

    group.forEach((word, wordIndex) => {
      const startSeconds = word.start;
      const nextStartSeconds =
        wordIndex < group.length - 1 ? group[wordIndex + 1].start : groupEnd;

      const start = formatTime(startSeconds);
      const end = formatTime(nextStartSeconds);

      const text = group
        .map((w, i) => {
          const t = escapeAssText(w.text);

          if (i < wordIndex) {
            // already spoken words - normal style
            return t;
          }

          if (i === wordIndex) {
            // highlighted word
            return `{\\rHighlight}${t}{\\rDefault}`;
          }

          // future words - hidden
          return `{\\alpha&HFF&}${t}{\\alpha&H00&}`;
        })
        .join(' ');

      assContent += `Dialogue: 0,${start},${end},Default,,${styles.marginH},${styles.marginH},${styles.marginV},,${text}\n`;
    });

    assContent += '\n';
  });

  return assContent;
}

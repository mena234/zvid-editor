import {
  escapeAssText,
  formatTime,
  joinAssWords,
} from '../../../utils/subtitles';
import type { Subtitle, SubtitleStyles } from '../../../types/text';

// Generate ASS content: words fade in one by one as spoken and stay visible
export function generateASSContent(subtitle: Subtitle) {
  const styles = subtitle.styles as SubtitleStyles;
  const groups = subtitle.captions.filter(
    (caption) => (caption.words?.length ?? 0) > 0
  );

  let assContent = ``;

  groups.forEach((caption, groupIndex) => {
    const group = caption.words!;
    assContent += `; Group ${groupIndex + 1}: "${group.map((w) => w.text).join(' ')}"\n`;

    const groupEnd = group[group.length - 1].end;

    group.forEach((word, wordIndex) => {
      const startSeconds = word.start;
      const nextStartSeconds =
        wordIndex < group.length - 1 ? group[wordIndex + 1].start : groupEnd;

      const start = formatTime(startSeconds);
      const end = formatTime(nextStartSeconds);

      const text = joinAssWords(caption, (w, i) => {
        const t = escapeAssText(w.text);

        if (i < wordIndex) {
          // already spoken words - fully visible
          return t;
        }

        if (i === wordIndex) {
          // active word fades in over 150ms
          return `{\\alpha&HFF&\\t(0,150,\\alpha&H00&)}${t}`;
        }

        if (i === wordIndex + 1) {
          // first future word: \rDefault cancels the fade \t, then hide;
          // the alpha override persists for the remaining words.
          return `{\\rDefault\\alpha&HFF&}${t}`;
        }

        // later future words inherit the hidden alpha
        return t;
      });

      assContent += `Dialogue: 0,${start},${end},Default,,${styles.marginH},${styles.marginH},${styles.marginV},,${text}\n`;
    });

    assContent += '\n';
  });

  return assContent;
}

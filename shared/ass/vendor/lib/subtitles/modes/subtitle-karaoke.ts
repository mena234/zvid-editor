import {
  escapeAssText,
  formatTime,
  joinAssWords,
} from '../../../utils/subtitles';
import type { Subtitle, SubtitleStyles } from '../../../types/text';

// Generate ASS content
export function generateASSContent(jsonData: Subtitle) {
  const styles = jsonData.styles as SubtitleStyles;
  const groups = jsonData.captions.filter(
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

        if (i === wordIndex) {
          // 🔹 Only the current word is highlighted (karaoke effect)
          return `{\\rHighlight}${t}{\\rDefault}`;
        }

        // 🔹 All other words visible as normal
        return t;
      });

      assContent += `Dialogue: 0,${start},${end},Default,,${styles.marginH},${styles.marginH},${styles.marginV},,${text}\n`;
    });

    assContent += '\n';
  });

  return assContent;
}

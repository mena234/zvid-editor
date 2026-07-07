import { escapeAssText, formatTime } from '../../../utils/subtitles';
import type { Subtitle, SubtitleStyles } from '../../../types/text';

// Generate ASS content: classic karaoke sweep — each word's color fills
// left-to-right (base color → active color) in sync with speech, and spoken
// words keep the active color. Uses \kf on the "Fill" style, whose
// SecondaryColour is the base text color and PrimaryColour the active color.
export function generateASSContent(subtitle: Subtitle) {
  const styles = subtitle.styles as SubtitleStyles;
  const groups = subtitle.captions
    .map((caption) => caption.words ?? [])
    .filter((group) => group.length > 0);

  let assContent = ``;

  groups.forEach((group, groupIndex) => {
    assContent += `; Group ${groupIndex + 1}: "${group.map((w) => w.text).join(' ')}"\n`;

    const groupStart = group[0].start;
    const groupEnd = group[group.length - 1].end;

    const start = formatTime(groupStart);
    const end = formatTime(groupEnd);

    // One dialogue per group: each word is a \kf syllable whose duration
    // (centiseconds) runs until the next word starts, so the sweep is continuous.
    const text = group
      .map((word, i) => {
        const nextStartSeconds =
          i < group.length - 1 ? group[i + 1].start : groupEnd;
        const durationCs = Math.max(
          1,
          Math.round((nextStartSeconds - word.start) * 100)
        );
        return `{\\kf${durationCs}}${escapeAssText(word.text)}`;
      })
      .join(' ');

    assContent += `Dialogue: 0,${start},${end},Fill,,${styles.marginH},${styles.marginH},${styles.marginV},,${text}\n\n`;
  });

  return assContent;
}

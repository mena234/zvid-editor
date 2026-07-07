import { escapeAssText, formatTime } from '../../../utils/subtitles';
import type { Subtitle, SubtitleStyles } from '../../../types/text';

// Generate ASS content: characters type on one by one in sync with each
// word's timing. Each character is a \k karaoke syllable on the Default
// style, whose SecondaryColour is fully transparent — unsung (future)
// characters are invisible but still occupy their space, so the layout is
// stable while the text "types" in.
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

    // One dialogue per group: each word's characters split the window until
    // the next word starts, so typing speed follows the spoken pace.
    let text = '';
    group.forEach((word, i) => {
      const sweepEnd = i < group.length - 1 ? group[i + 1].start : groupEnd;
      const chars = [...word.text];
      const windowCs = Math.max(
        chars.length,
        Math.round((sweepEnd - word.start) * 100)
      );
      // accumulate rounded per-char durations so drift stays under 1cs
      let spentCs = 0;
      chars.forEach((ch, ci) => {
        const targetCs = Math.round(((ci + 1) * windowCs) / chars.length);
        const durCs = Math.max(1, targetCs - spentCs);
        spentCs += durCs;
        text += `{\\k${durCs}}${escapeAssText(ch)}`;
      });
      if (i < group.length - 1) text += `{\\k0} `;
    });

    assContent += `Dialogue: 0,${start},${end},Default,,${styles.marginH},${styles.marginH},${styles.marginV},,${text}\n\n`;
  });

  return assContent;
}

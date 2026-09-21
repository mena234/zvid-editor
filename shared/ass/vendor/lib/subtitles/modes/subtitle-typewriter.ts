import {
  escapeAssText,
  formatTime,
  captionSeparators,
  graphemes,
} from '../../../utils/subtitles';
import type { Subtitle, SubtitleStyles } from '../../../types/text';

// Generate ASS content: grapheme clusters type on one by one in sync with each
// word's timing. Each cluster is a \k karaoke syllable on the Default
// style, whose SecondaryColour is fully transparent — unsung (future)
// clusters are invisible but still occupy their space, so the layout is
// stable while the text "types" in.
export function generateASSContent(subtitle: Subtitle) {
  const styles = subtitle.styles as SubtitleStyles;
  const groups = subtitle.captions.filter(
    (caption) => (caption.words?.length ?? 0) > 0
  );

  let assContent = ``;

  groups.forEach((caption, groupIndex) => {
    const group = caption.words!;
    assContent += `; Group ${groupIndex + 1}: "${group.map((w) => w.text).join(' ')}"\n`;

    const groupStart = group[0].start;
    const groupEnd = group[group.length - 1].end;

    const start = formatTime(groupStart);
    const end = formatTime(groupEnd);

    // One dialogue per group: each word's clusters split the window until
    // the next word starts, so typing speed follows the spoken pace.
    const separators = captionSeparators(caption);
    let text = escapeAssText(separators[0]);
    group.forEach((word, i) => {
      const sweepEnd = i < group.length - 1 ? group[i + 1].start : groupEnd;
      const chars = graphemes(
        word.text + (i === group.length - 1 ? separators[group.length] : '')
      );
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
      if (i < group.length - 1)
        text += `{\\k0}${escapeAssText(separators[i + 1])}`;
    });

    assContent += `Dialogue: 0,${start},${end},Default,,${styles.marginH},${styles.marginH},${styles.marginV},,${text}\n\n`;
  });

  return assContent;
}

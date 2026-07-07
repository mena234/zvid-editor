import { escapeAssText, formatTime } from '../../../utils/subtitles';
import { wrapWordIndicesByWidth } from '../../../utils/textWrappingMeasurement';
import type { Subtitle, SubtitleStyles } from '../../../types/text';
import configInstance from '../../config/config';

// Scale keyframes for the active word, expressed as chained ASS \t transforms.
const SCALE_ANIMATIONS = {
  // Quick punch up, then settle slightly — energetic emphasis.
  pop: '\\t(0,120,\\fscx130\\fscy130)\\t(120,240,\\fscx118\\fscy118)',
  // Spring: overshoot, dip below rest size, settle back to normal.
  bounce:
    '\\t(0,90,\\fscx135\\fscy135)\\t(90,180,\\fscx92\\fscy92)\\t(180,270,\\fscx108\\fscy108)\\t(270,360,\\fscx100\\fscy100)',
} as const;

// Peak \fscx of each animation — a wrapped line must still fit the margins
// while its widest word is scaled up by this factor.
const SCALE_PEAKS = {
  pop: 1.3,
  bounce: 1.35,
} as const;

export type ScaleAnimation = keyof typeof SCALE_ANIMATIONS;

// Generate ASS content: all words visible, the active word scales up while spoken
//
// The scale animation inflates the active word's advance width, which would
// move every other word on the line (and, near the margin width, make libass
// re-break lines mid-word — it re-computes wrapping every frame). Two guards:
//
// 1. Lines are wrapped once per group (with headroom for the peak scale),
//    emitted as hard `\N` breaks with `\q2`, so breaks never change.
// 2. Each word is drawn as TWO events: a base layer containing the full line
//    with zero scaling (the active word's slot rendered invisible), plus an
//    overlay layer where only the active word is visible and scaled. The
//    overlay still contains the whole line so the word lands exactly in its
//    slot; its own line re-centering makes the word grow symmetrically around
//    its slot while the base layer — the words the viewer sees — never moves.
export function generateASSContent(
  jsonData: Subtitle,
  animation: ScaleAnimation
) {
  const styles = jsonData.styles as SubtitleStyles;
  const { width: projectWidth } = configInstance.getConfig();
  const wrapWidth = projectWidth - 2 * (styles.marginH ?? 0);
  const groups = jsonData.captions
    .map((caption) => caption.words ?? [])
    .filter((group) => group.length > 0);

  let assContent = ``;

  groups.forEach((group, groupIndex) => {
    assContent += `; Group ${groupIndex + 1}: "${group.map((w) => w.text).join(' ')}"\n`;

    const groupEnd = group[group.length - 1].end;

    // Indices of words that start a new (pre-wrapped) line.
    const lines = wrapWordIndicesByWidth(
      group.map((w) => w.text),
      wrapWidth,
      styles.fontSize ?? 50,
      styles.fontFamily ?? 'Poppins',
      {
        isBold: styles.isBold,
        isItalic: styles.isItalic,
        scaleHeadroom: SCALE_PEAKS[animation],
      }
    );
    const lineStarts = new Set(lines.slice(1).map((line) => line[0]));

    group.forEach((word, wordIndex) => {
      const startSeconds = word.start;
      const nextStartSeconds =
        wordIndex < group.length - 1 ? group[wordIndex + 1].start : groupEnd;

      const start = formatTime(startSeconds);
      const end = formatTime(nextStartSeconds);

      const separator = (i: number) =>
        i === 0 ? '' : lineStarts.has(i) ? '\\N' : ' ';

      // Base layer: the full line, no scaling anywhere, active word's slot
      // kept blank (invisible) for the overlay to fill.
      const baseText = group
        .map((w, i) => {
          const t = escapeAssText(w.text);
          const token = i === wordIndex ? `{\\alpha&HFF&}${t}{\\rDefault}` : t;
          return `${separator(i)}${token}`;
        })
        .join('');

      // Overlay layer: everything hidden except the active word, which gets
      // the Highlight style + scale animation. \rHighlight resets the hiding
      // alpha to the style's (visible) one; \rDefault afterwards cancels the
      // \t and \alpha&HFF& re-hides the remaining words.
      const overlayText = group
        .map((w, i) => {
          const t = escapeAssText(w.text);
          const token =
            i === wordIndex
              ? `{\\rHighlight${SCALE_ANIMATIONS[animation]}}${t}{\\rDefault\\alpha&HFF&}`
              : t;
          return `${separator(i)}${token}`;
        })
        .join('');

      assContent += `Dialogue: 0,${start},${end},Default,,${styles.marginH},${styles.marginH},${styles.marginV},,{\\q2}${baseText}\n`;
      assContent += `Dialogue: 1,${start},${end},Default,,${styles.marginH},${styles.marginH},${styles.marginV},,{\\q2\\alpha&HFF&}${overlayText}\n`;
    });

    assContent += '\n';
  });

  return assContent;
}

import { escapeAssText, formatASSTime } from '../../../utils/subtitles';
import type { Subtitle, SubtitleStyles } from '../../../types/text';
import configInstance from '../../config/config';

const SLIDE_DURATION_MS = 300;
const SLIDE_FADE_MS = 150;

// Unit vector of a word's movement (it slides *towards* this direction).
const SLIDE_VECTORS: Record<string, [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

// \move overrides the style's margin-based placement, so recompute the anchor
// point the alignment would have produced from position + margins.
function computeAnchor(
  styles: SubtitleStyles,
  width: number,
  height: number
): [number, number] {
  const [vertical = 'bottom', horizontal = 'center'] = (
    styles.position || 'bottom-center'
  ).split('-');
  const marginH = styles.marginH ?? 0;
  const marginV = styles.marginV ?? 0;

  const x =
    horizontal === 'left'
      ? marginH
      : horizontal === 'right'
        ? width - marginH
        : width / 2;
  const y =
    vertical === 'top'
      ? marginV
      : vertical === 'center'
        ? height / 2
        : height - marginV;

  return [x, y];
}

// Generate ASS content: each word slides into place as it is spoken, from
// the direction opposite to styles.slideDirection (default "up").
//
// Per-word movement in ASS: one dialogue layer per word, each containing the
// FULL line so every layer lays the text out identically — but only the
// layer's own word is opaque (the rest are \alpha&HFF& invisible). The layer
// \move-s in from the slide offset when its word starts, so the visible word
// travels into its exact slot in the line and stays there.
export function generateASSContent(subtitle: Subtitle) {
  const styles = subtitle.styles as SubtitleStyles;
  const { width, height } = configInstance.getConfig();

  const [x, y] = computeAnchor(styles, width, height);
  const [dx, dy] = SLIDE_VECTORS[styles.slideDirection || 'up'];
  const distance = Math.max(48, styles.fontSize ?? 50);
  const startX = Math.round(x - dx * distance);
  const startY = Math.round(y - dy * distance);
  const entrance = `{\\move(${startX},${startY},${Math.round(x)},${Math.round(y)},0,${SLIDE_DURATION_MS})}`;

  let assContent = ``;

  subtitle.captions.forEach((caption, captionIndex) => {
    const words = caption.words ?? [];

    // \move pins every caption to the same anchor point, which disables
    // libass collision handling — captions overlapping in time would slide
    // in on top of each other. Clamp each caption's end to the moment the
    // next caption becomes visible so only one line occupies the anchor.
    const next = subtitle.captions[captionIndex + 1];
    const nextVisibleStart = next
      ? next.words?.length
        ? next.words[0].start
        : next.start
      : Infinity;
    const endSeconds = Math.min(caption.end, nextVisibleStart);
    const end = formatASSTime(endSeconds);

    // every word sets its own alpha explicitly (\fad is unreliable next to
    // \alpha overrides in libass): the layer's word fades in via \t, the
    // rest stay fully transparent
    const fadeIn = `\\alpha&HFF&\\t(0,${SLIDE_FADE_MS},\\alpha&H00&)`;

    if (words.length === 0) {
      // no word timings: slide the whole caption in at once
      const start = formatASSTime(caption.start);
      assContent += `Dialogue: 0,${start},${end},Default,,${styles.marginH},${styles.marginH},${styles.marginV},,${entrance}{${fadeIn}}${escapeAssText(caption.text)}\n`;
      return;
    }

    assContent += `; Caption ${captionIndex + 1}: "${words.map((w) => w.text).join(' ')}"\n`;

    words.forEach((word, i) => {
      // A word starting after the clamped end would produce a negative-
      // duration event; the next caption owns the anchor by then anyway.
      if (word.start >= endSeconds) return;

      const start = formatASSTime(word.start);
      const text = words
        .map((w, j) => {
          const t = escapeAssText(w.text);
          return j === i ? `{${fadeIn}}${t}` : `{\\alpha&HFF&}${t}`;
        })
        .join(' ');

      assContent += `Dialogue: ${i},${start},${end},Default,,${styles.marginH},${styles.marginH},${styles.marginV},,${entrance}${text}\n`;
    });

    assContent += '\n';
  });

  return assContent;
}

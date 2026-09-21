import {
  escapeAssText,
  formatTime,
  joinAssWords,
  captionSeparators,
} from '../../../utils/subtitles';
import type { Caption, Subtitle, SubtitleStyles } from '../../../types/text';
import type { SubtitleMeasure } from '../../../utils/subtitleFontMetrics';
import { hasRtlText } from '../../../utils/subtitleBidi';
import { layoutGroup } from '../roundedBoxes';
import configInstance from '../../config/config';

/**
 * ASS \kf always sweeps left to right, including Arabic/Hebrew syllables.
 * Keep the complete shaped line on every layer and reveal its colored word
 * with a moving clip in the direction of each Unicode bidi run instead.
 */
function generateDirectionalFill(
  caption: Caption,
  styles: SubtitleStyles,
  measure: SubtitleMeasure
): string {
  const words = caption.words!;
  const separators = captionSeparators(caption);
  const { width, height } = configInstance.getConfig();
  const lines = layoutGroup(words.map(word => word.text), words, styles, { measure }, 'fill', width, height, separators);
  const lineStarts = new Set(lines.slice(1).map(line => words.indexOf(line.words[0])));
  const textFor = (active = -1) => words.map((word, i) => {
    const gap = lineStarts.has(i)
      ? `${escapeAssText(separators[i].trimEnd())}\\N`
      : escapeAssText(separators[i]);
    const text = escapeAssText(word.text);
    return gap + (i === active ? `{\\alpha&H00&}${text}{\\alpha&HFF&}` : text);
  }).join('') + escapeAssText(separators[words.length]);
  const end = formatTime(words[words.length - 1].end);
  const margins = `${styles.marginH},${styles.marginH},${styles.marginV}`;
  let content = `Dialogue: 0,${formatTime(words[0].start)},${end},Default,,${margins},,{\\q2}${textFor()}\n`;
  const round = (value: number) => Math.round(value * 100) / 100;
  for (const line of lines) for (let i = 0; i < line.words.length; i++) {
    const word = line.words[i];
    const index = words.indexOf(word);
    const nextStart = index + 1 < words.length ? words[index + 1].start : word.end;
    const duration = Math.max(1, Math.round((nextStart - word.start) * 1000));
    const spans = line.wordSpans[i].slice().sort((a, b) => a.logicalStart - b.logicalStart);
    const total = spans.reduce((sum, span) => sum + span.width, 0);
    let elapsed = 0;
    for (const span of spans) {
      const spanDuration = total ? duration * span.width / total : duration;
      // A few pixels include glyph overhang and antialiasing at the outside
      // edges. Other words stay transparent on this layer.
      const overhang = spans.length === 1 ? 4 : 0;
      const left = round(line.left + span.left - overhang);
      const right = round(line.left + span.left + span.width + overhang);
      const edge = span.direction === 'rtl' ? right : left;
      const clip = `\\clip(${edge},0,${edge},${height})\\t(${Math.round(elapsed)},${Math.round(elapsed + spanDuration)},\\clip(${left},0,${right},${height}))`;
      content += `Dialogue: 1,${formatTime(word.start)},${end},Fill,,${margins},,{\\q2\\alpha&HFF&${clip}}${textFor(index)}\n`;
      elapsed += spanDuration;
    }
  }
  return content + '\n';
}

// Generate ASS content: classic karaoke sweep — each word's color fills
// left-to-right (base color → active color) in sync with speech, and spoken
// words keep the active color. Uses \kf on the "Fill" style, whose
// SecondaryColour is the base text color and PrimaryColour the active color.
export function generateASSContent(subtitle: Subtitle, measure?: SubtitleMeasure) {
  const styles = subtitle.styles as SubtitleStyles;
  const groups = subtitle.captions.filter(
    (caption) => (caption.words?.length ?? 0) > 0
  );

  let assContent = ``;

  groups.forEach((caption, groupIndex) => {
    const group = caption.words!;
    assContent += `; Group ${groupIndex + 1}: "${group.map((w) => w.text).join(' ')}"\n`;
    if (hasRtlText(caption.text ?? group.map(word => word.text).join(' '))) {
      if (!measure) throw new Error('RTL subtitle fill requires calibrated font metrics');
      assContent += generateDirectionalFill(caption, styles, measure);
      return;
    }

    const groupStart = group[0].start;
    const groupEnd = group[group.length - 1].end;

    const start = formatTime(groupStart);
    const end = formatTime(groupEnd);

    // One dialogue per group: each word is a \kf syllable whose duration
    // (centiseconds) runs until the next word starts, so the sweep is continuous.
    const text = joinAssWords(caption, (word, i) => {
      const nextStartSeconds =
        i < group.length - 1 ? group[i + 1].start : groupEnd;
      const durationCs = Math.max(
        1,
        Math.round((nextStartSeconds - word.start) * 100)
      );
      return `{\\kf${durationCs}}${escapeAssText(word.text)}`;
    });

    assContent += `Dialogue: 0,${start},${end},Fill,,${styles.marginH},${styles.marginH},${styles.marginV},,${text}\n\n`;
  });

  return assContent;
}

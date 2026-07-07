import type { SubtitleStyles } from '../../../types/text';
import configInstance from '../../config/config';
import generateStyles from './generateStyles';

// Modes whose active word is rendered with the Highlight style via {\rHighlight}.
const HIGHLIGHT_MODES = [
  'progressive',
  'karaoke',
  'highlight',
  'pop',
  'bounce',
];

export interface HeaderOptions {
  /**
   * ASS WrapStyle (rounded boxes force 1 = greedy end-of-line wrapping so the
   * measured box geometry matches libass' actual line breaks). Omitted →
   * no WrapStyle line, byte-identical with the historical header.
   */
  wrapStyle?: number;
  /** Extra Style lines (e.g. rounded-box fill styles). */
  extraStyleLines?: string[];
}

export default function generateHeader(
  styles: SubtitleStyles,
  options?: HeaderOptions
) {
  const { mode } = styles;
  const defaultStyleValues = generateStyles(styles, 'Default');
  let extraStyleValues = '';
  if (mode && HIGHLIGHT_MODES.includes(mode)) {
    extraStyleValues = `Style: ${generateStyles(styles, 'Highlight').join(',')}`;
  } else if (mode === 'fill') {
    extraStyleValues = `Style: ${generateStyles(styles, 'Fill').join(',')}`;
  }
  if (options?.extraStyleLines?.length) {
    extraStyleValues = `${extraStyleValues}${extraStyleValues ? '\n' : ''}${options.extraStyleLines.join('\n')}`;
  }
  const wrapStyleLine =
    options?.wrapStyle !== undefined ? `WrapStyle: ${options.wrapStyle}\n` : '';
  const { width, height } = configInstance.getConfig();

  const assHeader = `
[Script Info]
Title: Generated Subtitles
ScriptType: v4.00+
Collisions: Normal
PlayDepth: 0
${wrapStyleLine}PlayResX: ${width}
PlayResY: ${height}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: ${defaultStyleValues.join(',')}
${extraStyleValues}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  return assHeader;
}

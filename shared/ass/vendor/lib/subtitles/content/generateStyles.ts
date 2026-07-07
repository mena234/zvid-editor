import type { SubtitleStyles } from '../../../types/text';

export const convertColor = (hex: string): string => {
  let value = typeof hex === 'string' ? hex.trim().replace(/^#/, '') : '';
  if (!/^[0-9a-fA-F]{3,8}$/.test(value)) {
    value = 'ffffff';
  }
  // Expand #rgb / #rgba shorthand to the full form
  if (value.length === 3 || value.length === 4) {
    value = value
      .split('')
      .map((c) => c + c)
      .join('');
  }

  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  // CSS alpha: FF = opaque. ASS alpha: 00 = opaque. Invert when converting.
  const cssAlpha = value.length === 8 ? parseInt(value.slice(6, 8), 16) : 255;
  const assAlpha = 255 - cssAlpha;

  const pad = (n: number) => n.toString(16).padStart(2, '0');
  return `&H${pad(assAlpha)}${pad(b)}${pad(g)}${pad(r)}`;
};

function mapPositionToASS(pos: Pick<SubtitleStyles, 'position'>['position']) {
  const map = {
    'top-left': 7,
    'top-center': 8,
    'top-right': 9,
    'center-left': 4,
    'center-center': 5,
    'center-right': 6,
    'bottom-left': 1,
    'bottom-center': 2,
    'bottom-right': 3,
  };
  return pos ? map[pos] : 2;
}

export type StyleVariant = 'Default' | 'Highlight' | 'Fill';

export default function generateStyles(
  styles: SubtitleStyles,
  variant: StyleVariant = 'Default'
) {
  const {
    fontFamily: fontName,
    fontSize,
    outline,
    background,
    activeWord,
    color,
    isBold,
    isItalic,
  } = styles;
  const name = variant;
  // Highlight = instant active-word restyle; Fill = \kf karaoke sweep target.
  const isActive = variant === 'Highlight' || variant === 'Fill';
  const position = mapPositionToASS(styles.position);

  // The Style line is comma-separated; a CSS font stack ("Arial, sans-serif")
  // would shift every later field. ASS takes a single font name.
  const safeFontName = fontName
    ? String(fontName).split(',')[0].trim()
    : fontName;

  const primaryColor =
    isActive && activeWord && activeWord.color
      ? convertColor(activeWord.color)
      : convertColor(color as string);

  // \kf sweeps SecondaryColour → PrimaryColour, so Fill needs the base text
  // color as secondary; every other variant keeps it transparent/unused.
  const secondaryColor =
    variant === 'Fill'
      ? convertColor(color as string)
      : convertColor('#00000000');

  // ---- BACKGROUND HANDLING ----
  // The Highlight style can carry its own box behind the active word.
  const activeBackground =
    variant === 'Highlight' ? activeWord?.background : undefined;
  const hasBackground = !!activeBackground || !!background;

  // BackColour → THIS is the opaque box fill when BorderStyle = 3/4
  const backColor = activeBackground
    ? convertColor(activeBackground)
    : background
      ? convertColor(background)
      : convertColor('#00000000'); // fully transparent box when background "transparent"

  // Box + outline combinations (verified against ffmpeg/libass):
  //  - box only        → BorderStyle 3 (box in the BackColour shadow copy,
  //    Outline field = padding, Shadow=1) — kept byte-identical with the
  //    pre-combo output for existing projects
  //  - box + outline   → BorderStyle 4 (libass-specific): box from BackColour,
  //    Outline field = real stroke width, Shadow field = box padding
  //  - outline only    → BorderStyle 1
  const backgroundPadding = Math.max(0, styles.backgroundPadding ?? 0);
  const borderStyle = hasBackground ? (outline ? 4 : 3) : 1;

  const defaultStyles = [
    name, // Name
    safeFontName, // Fontname
    fontSize, // Fontsize
    primaryColor, // PrimaryColour
    secondaryColor, // SecondaryColour (base color for Fill's \kf sweep)
    outline ? convertColor(outline.color) : convertColor('#00000000'), // OutlineColour
    backColor, // BackColour (BOX FILL!)
    isBold ? 1 : 0, // Bold
    isItalic ? 1 : 0, // Italic
    0, // Underline
    0, // StrikeOut
    100, // ScaleX
    100, // ScaleY
    0, // Spacing
    0, // Angle
    borderStyle, // BorderStyle
    outline
      ? outline.width // stroke width (BorderStyle 1 and 4)
      : hasBackground
        ? backgroundPadding // BorderStyle 3: Outline field = box padding
        : 0, // Outline
    hasBackground ? (outline ? backgroundPadding : 1) : 0, // Shadow (BorderStyle 4: box padding)
    position, // Alignment
    0, // MarginL
    0, // MarginR
    0, // MarginV
    1, // Encoding
  ];

  return defaultStyles;
}

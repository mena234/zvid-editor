export interface Word {
  start: number;
  end: number;
  text: string;
}

export type Words = Word[];

export interface Caption {
  start: number;
  end: number;
  text?: string;
  words: Words;
}

export interface Subtitle {
  captions: Caption[];
  styles?: SubtitleStyles;
}

/**
 * Caption as accepted from user input: `words` is optional — when omitted,
 * word timings are distributed across the caption window by text length.
 */
export interface CaptionInput {
  start: number;
  end: number;
  text?: string;
  words?: Words;
}

export type SubtitleAnimation = NonNullable<SubtitleStyles['mode']>;

export type SubtitlePosition = NonNullable<SubtitleStyles['position']>;

/** `top` / `center` / `bottom` are shorthands for the `*-center` positions. */
export type SubtitlePositionInput =
  | SubtitlePosition
  | 'top'
  | 'center'
  | 'bottom';

export interface SubtitleFont {
  /** Google Fonts family name. Default: Poppins. */
  family?: string;
  /** Font size in pixels. Default: 50. */
  size?: number;
  /** Hex color, optional alpha (#RRGGBB / #RRGGBBAA). Default: #FFFFFF. */
  color?: string;
  bold?: boolean;
  italic?: boolean;
  transform?: 'uppercase' | 'lowercase' | 'capitalize';
}

export interface SubtitleStroke {
  color: string;
  width: number;
}

export interface SubtitleBackground {
  /** Hex color, optional alpha. */
  color?: string;
  /** 0–1; multiplies the color's alpha. */
  opacity?: number;
  /** Box padding around the text, in pixels. */
  padding?: number;
  /** Corner radius in pixels. */
  radius?: number;
}

export interface SubtitleMargin {
  /** Horizontal distance in px from the edge implied by `position`. */
  x?: number;
  /** Vertical distance in px from the edge implied by `position`. */
  y?: number;
}

/**
 * Simplified subtitle schema (v2). Content comes from `src` (SRT/VTT URL) or
 * `captions`; style/animation fields sit flat on the object. The legacy
 * `{ captions, styles }` shape is still accepted (detected by the presence of
 * `styles`) and normalized to the same internal representation.
 */
export interface SubtitleV2 {
  /** URL of an SRT or VTT file. Alternative to `captions`. */
  src?: string;
  captions?: CaptionInput[];
  /** Per-word animation. Default: normal (static captions). */
  animation?: SubtitleAnimation;
  /** Entrance direction for `slide`. Default: up. */
  direction?: 'up' | 'down' | 'left' | 'right';
  font?: SubtitleFont;
  stroke?: SubtitleStroke;
  background?: SubtitleBackground;
  activeWord?: {
    color?: string;
    background?: string;
    /** Corner radius (px) of the active-word box. */
    radius?: number;
  };
  position?: SubtitlePositionInput;
  margin?: SubtitleMargin;
  /** Re-chunk captions so no line shows more than N words. */
  maxWordsPerLine?: number;
}

/** What `Project.subtitle` accepts: legacy shape or the simplified v2 shape. */
export type SubtitleInput = Subtitle | SubtitleV2;

export interface TextObject {
  text: string;
  y: number;
  width: number;
}

export interface StrokeOptions {
  width: number;
  color: string;
}

export interface BackgroundOptions {
  color: string;
  opacity: number;
  width: number;
}

export interface SubtitleStyles {
  color?: string;
  background?: string;
  /** Padding (px) of the background box; set via v2 `background.padding`. */
  backgroundPadding?: number;
  /**
   * Corner radius (px) of the background box; set via v2 `background.radius`.
   * Rendered as ASS vector drawings behind the text (libass boxes are square).
   */
  backgroundRadius?: number;
  isBold?: boolean;
  isItalic?: boolean;
  fontSize?: number;
  fontFamily?: string;
  textTransform?: 'uppercase' | 'lowercase' | 'capitalize';
  outline?: {
    width: number;
    color: string;
  };
  position?:
    | 'top-left'
    | 'top-center'
    | 'top-right'
    | 'bottom-left'
    | 'bottom-center'
    | 'bottom-right'
    | 'center-center'
    | 'center-left'
    | 'center-right';
  marginV?: number;
  marginH?: number;
  mode?:
    | 'normal'
    | 'none'
    | 'one-word'
    | 'karaoke'
    | 'progressive'
    | 'highlight'
    | 'fill'
    | 'pop'
    | 'bounce'
    | 'fade'
    | 'slide'
    | 'typewriter';
  /** Movement direction of the caption entrance in `slide` mode. */
  slideDirection?: 'up' | 'down' | 'left' | 'right';
  activeWord?: {
    color?: string;
    background?: string;
    /** Corner radius (px) of the active-word box. */
    radius?: number;
  };
}

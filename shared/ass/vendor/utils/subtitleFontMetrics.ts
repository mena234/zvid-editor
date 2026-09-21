import { graphemes } from './subtitleText';

export interface MeasuredSubtitleFont {
  family: string;
  data: Uint8Array;
  measure: (text: string) => number;
}

export type SubtitleMeasure = ((text: string) => number) & {
  range?: (text: string, start: number, end: number) => number;
};

/** Measure each fallback run at that font's own libass em scale. */
export function createSubtitleMeasurer(
  fonts: MeasuredSubtitleFont[],
  primary: string,
  covers: (data: Uint8Array, text: string) => boolean
): SubtitleMeasure {
  const ordered = [...fonts].sort(
    (a, b) => Number(b.family === primary) - Number(a.family === primary)
  );
  const range = (text: string, start = 0, end = text.length) => {
    let active = ordered[0];
    let run = '';
    let width = 0;
    let cursor = 0;
    for (const cluster of graphemes(text)) {
      const neutral =
        /^[\p{Script=Common}\p{Script=Inherited}\p{Cf}\s]+$/u.test(cluster);
      const face =
        neutral && covers(active.data, cluster)
          ? active
          : (ordered.find((font) => covers(font.data, cluster)) ?? active);
      if (face !== active) {
        width += active.measure(run);
        active = face;
        run = '';
      }
      if (cursor >= start && cursor < end) run += cluster;
      cursor += cluster.length;
    }
    return width + active.measure(run);
  };
  return Object.assign((text: string) => range(text), { range });
}

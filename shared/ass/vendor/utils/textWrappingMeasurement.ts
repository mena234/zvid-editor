/**
 * Browser shim of package/src/utils/textWrappingMeasurement.ts — identical
 * wrapping algorithm, measured with a DOM canvas instead of @napi-rs/canvas.
 * Fonts are registered document-wide via FontFace by shared/ass/fontMetrics.ts
 * from the SAME TTF files the renderer downloads, so measurements agree.
 */

let ctx: CanvasRenderingContext2D | null = null
function getCtx(): CanvasRenderingContext2D | null {
  if (ctx) return ctx
  if (typeof document === 'undefined') return null
  ctx = document.createElement('canvas').getContext('2d')
  return ctx
}

function measureText(
  text: string,
  fontSize: number,
  fontFamily: string,
  fontStyle: string = ''
) {
  const c = getCtx()
  if (!c) return text.length * fontSize * 0.6
  // A CSS font stack ("Arial, sans-serif") is not a valid single family name.
  const family = fontFamily.split(',')[0].trim()
  c.font = `${fontStyle}${fontSize}px "${family}"`
  return c.measureText(text).width
}

/**
 * Wrap a sequence of words into lines that fit `maxWidth`, returned as arrays
 * of indices into `wordTexts` — verbatim port of the package algorithm.
 */
export function wrapWordIndicesByWidth(
  wordTexts: string[],
  maxWidth: number,
  fontSize: number,
  fontFamily: string,
  options: {
    isBold?: boolean;
    isItalic?: boolean;
    scaleHeadroom?: number;
    separators?: string[];
    measure?: (text: string) => number;
  } = {}
): number[][] {
  const fontStyle = `${options.isItalic ? 'italic ' : ''}${options.isBold ? 'bold ' : ''}`;
  const headroom = options.scaleHeadroom ?? 1;
  const measure = options.measure ?? ((text: string) => measureText(text, fontSize, fontFamily, fontStyle));
  const wordWidths = wordTexts.map((t) => measure(t));

  const lines: number[][] = [];
  let current: number[] = [];

  wordTexts.forEach((_, i) => {
    if (/\r?\n/.test(options.separators?.[i] ?? "") && current.length) {
      lines.push(current);
      current = [];
    }
    const candidate = [...current, i];
    const lineText = candidate.map((j, k) => `${k ? (options.separators?.[j] ?? ' ') : j === 0 ? options.separators?.[0] ?? '' : ''}${wordTexts[j]}`).join('')
      + (i === wordTexts.length - 1 ? options.separators?.[wordTexts.length] ?? '' : (options.separators?.[i + 1] ?? '').trimEnd());
    const lineWidth = measure(lineText);
    const widestWord = Math.max(...candidate.map((j) => wordWidths[j]));
    // Only one word is scaled up at a time, so reserving headroom for the
    // widest word covers the worst case.
    const effectiveWidth = lineWidth + (headroom - 1) * widestWord;

    if (effectiveWidth > maxWidth && current.length > 0) {
      lines.push(current);
      current = [i];
    } else {
      current = candidate;
    }
  });

  if (current.length > 0) {
    lines.push(current);
  }

  return lines;
}

import type { ShapeDef, ShapePaintCtx } from './shapes'

/**
 * Extended shape library for the Design Studio (~210 shapes).
 *
 * Same contract as shapes.ts: every def is pure inline SVG built from the
 * layer's paint context — no external resources, so the compiled output
 * passes the package's customCode sanitizer untouched. Procedural families
 * (polygons, stars, bursts, seals, gears, flowers, patterns) are generated
 * from the helpers below; everything else is a hand-crafted path.
 */

type SvgFn = (viewW: number, viewH: number, p: ShapePaintCtx) => string

const N = (v: number) => Math.round(v * 10) / 10

const fillPath = (d: string): SvgFn => (_w, _h, p) => `<path d="${d}" fill="${p.fill}"/>`

const evenOdd = (d: string): SvgFn => (_w, _h, p) =>
  `<path d="${d}" fill="${p.fill}" fill-rule="evenodd"/>`

const fillPoly = (pts: string, transform = ''): SvgFn => (_w, _h, p) =>
  `<polygon points="${pts}" fill="${p.fill}"${transform ? ` transform="${transform}"` : ''}/>`

const strokePath =
  (d: string, extra = ''): SvgFn =>
  (_w, _h, p) =>
    `<path d="${d}" stroke="${p.accent}" stroke-width="${p.strokeWidth}" fill="none" stroke-linecap="round" stroke-linejoin="round"${extra}/>`

/** several fill/stroke fragments combined into one shape */
const parts = (...fns: SvgFn[]): SvgFn => (w, h, p) => fns.map((f) => f(w, h, p)).join('')

const fillCircle = (cx: number, cy: number, r: number): SvgFn => (_w, _h, p) =>
  `<circle cx="${N(cx)}" cy="${N(cy)}" r="${N(r)}" fill="${p.fill}"/>`

const fillEllipse = (cx: number, cy: number, rx: number, ry: number, rot = 0): SvgFn => (_w, _h, p) =>
  `<ellipse cx="${N(cx)}" cy="${N(cy)}" rx="${N(rx)}" ry="${N(ry)}" fill="${p.fill}"${rot ? ` transform="rotate(${rot} ${N(cx)} ${N(cy)})"` : ''}/>`

const fillRect = (x: number, y: number, w: number, h: number, rx = 0): SvgFn => (_w, _h, p) =>
  `<rect x="${N(x)}" y="${N(y)}" width="${N(w)}" height="${N(h)}"${rx ? ` rx="${N(rx)}"` : ''} fill="${p.fill}"/>`

/* ---------------- procedural path builders ---------------- */

/** regular n-gon "x,y x,y …" centered on (cx,cy) */
function polyPts(n: number, cx = 150, cy = 150, r = 145, rotDeg = -90): string {
  const pts: string[] = []
  for (let i = 0; i < n; i++) {
    const a = ((rotDeg + (i * 360) / n) * Math.PI) / 180
    pts.push(`${N(cx + Math.cos(a) * r)},${N(cy + Math.sin(a) * r)}`)
  }
  return pts.join(' ')
}

/** star/burst points alternating outer/inner radius */
function starPts(points: number, inner: number, cx = 150, cy = 150, r = 145, rotDeg = -90): string {
  const pts: string[] = []
  for (let i = 0; i < points * 2; i++) {
    const rr = i % 2 === 0 ? r : r * inner
    const a = ((rotDeg + (i * 360) / (points * 2)) * Math.PI) / 180
    pts.push(`${N(cx + Math.cos(a) * rr)},${N(cy + Math.sin(a) * rr)}`)
  }
  return pts.join(' ')
}

/** full circle as path data (usable in evenodd compounds) */
function circleD(cx: number, cy: number, r: number): string {
  return `M ${N(cx + r)} ${N(cy)} A ${N(r)} ${N(r)} 0 1 0 ${N(cx - r)} ${N(cy)} A ${N(r)} ${N(r)} 0 1 0 ${N(cx + r)} ${N(cy)} Z `
}

/** rounded rectangle as path data (usable in evenodd compounds) */
function roundRectD(x: number, y: number, w: number, h: number, r = 0): string {
  if (r <= 0) return `M ${N(x)} ${N(y)} H ${N(x + w)} V ${N(y + h)} H ${N(x)} Z `
  return (
    `M ${N(x + r)} ${N(y)} H ${N(x + w - r)} A ${N(r)} ${N(r)} 0 0 1 ${N(x + w)} ${N(y + r)} ` +
    `V ${N(y + h - r)} A ${N(r)} ${N(r)} 0 0 1 ${N(x + w - r)} ${N(y + h)} H ${N(x + r)} ` +
    `A ${N(r)} ${N(r)} 0 0 1 ${N(x)} ${N(y + h - r)} V ${N(y + r)} A ${N(r)} ${N(r)} 0 0 1 ${N(x + r)} ${N(y)} Z `
  )
}

/** regular n-gon as path data */
function polyD(n: number, cx = 150, cy = 150, r = 145, rotDeg = -90): string {
  const pts = polyPts(n, cx, cy, r, rotDeg).split(' ')
  return `M ${pts[0].replace(',', ' ')} ${pts.slice(1).map((p) => `L ${p.replace(',', ' ')}`).join(' ')} Z `
}

/** scalloped seal: quadratic bumps between valley points */
function sealD(lobes: number, cx = 150, cy = 150, rIn = 120, rOut = 168): string {
  let d = ''
  for (let i = 0; i < lobes; i++) {
    const a0 = (i / lobes) * 2 * Math.PI - Math.PI / 2
    const a1 = ((i + 1) / lobes) * 2 * Math.PI - Math.PI / 2
    const am = (a0 + a1) / 2
    const x0 = cx + Math.cos(a0) * rIn
    const y0 = cy + Math.sin(a0) * rIn
    if (i === 0) d += `M ${N(x0)} ${N(y0)} `
    d += `Q ${N(cx + Math.cos(am) * rOut)} ${N(cy + Math.sin(am) * rOut)} ${N(cx + Math.cos(a1) * rIn)} ${N(cy + Math.sin(a1) * rIn)} `
  }
  return d + 'Z '
}

/** gear outline with trapezoidal teeth (polygon path) */
function gearD(teeth: number): string {
  const rOut = 145
  const rBase = 108
  const step = 360 / teeth
  const pts: string[] = []
  for (let i = 0; i < teeth; i++) {
    const a = -90 + i * step
    const angs: [number, number][] = [
      [a - step * 0.16, rOut],
      [a + step * 0.16, rOut],
      [a + step * 0.3, rBase],
      [a + step * 0.7, rBase],
    ]
    for (const [deg, r] of angs) {
      const rad = (deg * Math.PI) / 180
      pts.push(`${N(150 + Math.cos(rad) * r)} ${N(150 + Math.sin(rad) * r)}`)
    }
  }
  return `M ${pts[0]} ${pts.slice(1).map((p) => `L ${p}`).join(' ')} Z `
}

/** flower: n petal ellipses + center dot */
const flower = (petals: number, rx: number, ry: number): SvgFn => (_w, _h, p) => {
  const out: string[] = []
  for (let i = 0; i < petals; i++) {
    out.push(
      `<ellipse cx="150" cy="${N(150 - (148 - ry))}" rx="${rx}" ry="${ry}" fill="${p.fill}" transform="rotate(${N((i * 360) / petals)} 150 150)"/>`
    )
  }
  out.push(`<circle cx="150" cy="150" r="36" fill="${p.fill}"/>`)
  return out.join('')
}

/** asterisk: n rounded rays from the center */
const asterisk = (arms: number, armW = 34): SvgFn => (_w, _h, p) => {
  const out: string[] = []
  for (let i = 0; i < arms; i++) {
    out.push(
      `<rect x="${N(150 - armW / 2)}" y="6" width="${armW}" height="${N(144 + armW / 2)}" rx="${N(armW / 2)}" fill="${p.fill}" transform="rotate(${N((i * 360) / arms)} 150 150)"/>`
    )
  }
  return out.join('')
}

/* ================================================================== */
/* the library                                                         */
/* ================================================================== */

export const EXTRA_SHAPES: Record<string, ShapeDef> = {
  /* ---------------- Geometry ---------------- */
  square: { label: 'Square', group: 'Geometry', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: fillRect(16, 16, 268, 268) },
  'rounded-square': { label: 'Rounded square', group: 'Geometry', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: fillRect(16, 16, 268, 268, 44) },
  oval: { label: 'Oval', group: 'Geometry', kind: 'svg', viewBox: [300, 210], ratio: 300 / 210, svg: fillEllipse(150, 105, 142, 97) },
  semicircle: { label: 'Semicircle', group: 'Geometry', kind: 'svg', viewBox: [300, 160], ratio: 300 / 160, svg: fillPath('M10 150 A140 140 0 0 1 290 150 Z') },
  'quarter-circle': { label: 'Quarter circle', group: 'Geometry', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: fillPath('M20 280 V20 A260 260 0 0 1 280 280 Z') },
  pie: { label: 'Pie', group: 'Geometry', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: fillPath('M150 150 L150 10 A140 140 0 1 1 10 150 Z') },
  wedge: { label: 'Wedge', group: 'Geometry', kind: 'svg', viewBox: [150, 150], ratio: 1, svg: fillPath('M75 148 L5 22 A150 150 0 0 1 145 22 Z') },
  crescent: { label: 'Crescent', group: 'Geometry', kind: 'svg', viewBox: [155, 300], ratio: 155 / 300, svg: fillPath('M150 20 A130 130 0 1 0 150 280 A165 165 0 0 1 150 20 Z') },
  lens: { label: 'Lens', group: 'Geometry', kind: 'svg', viewBox: [110, 300], ratio: 110 / 300, svg: fillPath('M55 10 A210 210 0 0 1 55 290 A210 210 0 0 1 55 10 Z') },
  egg: { label: 'Egg', group: 'Geometry', kind: 'svg', viewBox: [230, 280], ratio: 230 / 280, svg: fillPath('M115 8 C172 8 220 80 220 160 C220 225 173 272 115 272 C57 272 10 225 10 160 C10 80 58 8 115 8 Z') },
  teardrop: { label: 'Teardrop', group: 'Geometry', kind: 'svg', viewBox: [230, 290], ratio: 230 / 290, svg: fillPath('M115 8 C115 8 10 148 10 195 C10 252 57 282 115 282 C173 282 220 252 220 195 C220 148 115 8 115 8 Z') },
  pentagon: { label: 'Pentagon', group: 'Geometry', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: fillPoly(polyPts(5, 150, 158, 148)) },
  heptagon: { label: 'Heptagon', group: 'Geometry', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: fillPoly(polyPts(7, 150, 153, 145)) },
  octagon: { label: 'Octagon', group: 'Geometry', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: fillPoly(polyPts(8, 150, 150, 145, -67.5)) },
  nonagon: { label: 'Nonagon', group: 'Geometry', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: fillPoly(polyPts(9, 150, 152, 144)) },
  decagon: { label: 'Decagon', group: 'Geometry', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: fillPoly(polyPts(10, 150, 150, 144)) },
  dodecagon: { label: 'Dodecagon', group: 'Geometry', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: fillPoly(polyPts(12, 150, 150, 144, -75)) },
  'triangle-right': { label: 'Right triangle', group: 'Geometry', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: fillPoly('20,20 20,280 280,280') },
  'inverted-triangle': { label: 'Inverted triangle', group: 'Geometry', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: fillPoly('18,25 282,25 150,275') },
  parallelogram: { label: 'Parallelogram', group: 'Geometry', kind: 'svg', viewBox: [300, 200], ratio: 1.5, svg: fillPoly('62,15 292,15 238,185 8,185') },
  trapezoid: { label: 'Trapezoid', group: 'Geometry', kind: 'svg', viewBox: [300, 200], ratio: 1.5, svg: fillPoly('75,15 225,15 292,185 8,185') },
  kite: { label: 'Kite', group: 'Geometry', kind: 'svg', viewBox: [210, 300], ratio: 210 / 300, svg: fillPoly('105,8 200,112 105,292 10,112') },
  'rhombus-wide': { label: 'Wide rhombus', group: 'Geometry', kind: 'svg', viewBox: [300, 190], ratio: 300 / 190, svg: fillPoly('150,8 292,95 150,182 8,95') },
  'chevron-block': { label: 'Chevron', group: 'Geometry', kind: 'svg', viewBox: [250, 280], ratio: 250 / 280, svg: fillPoly('10,10 125,10 240,140 125,270 10,270 125,140') },
  'corner-l': { label: 'L corner', group: 'Geometry', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: fillPoly('25,25 130,25 130,170 275,170 275,275 25,275') },
  stairs: { label: 'Stairs', group: 'Geometry', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: fillPoly('20,280 20,193 107,193 107,107 193,107 193,20 280,20 280,280') },
  'plus-block': { label: 'Plus', group: 'Geometry', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: fillPoly('108,18 192,18 192,108 282,108 282,192 192,192 192,282 108,282 108,192 18,192 18,108 108,108') },
  'plus-thin': { label: 'Thin plus', group: 'Geometry', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: fillPoly('129,18 171,18 171,129 282,129 282,171 171,171 171,282 129,282 129,171 18,171 18,129 129,129') },
  'x-block': { label: 'Cross X', group: 'Geometry', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: fillPoly('108,18 192,18 192,108 282,108 282,192 192,192 192,282 108,282 108,192 18,192 18,108 108,108', 'rotate(45 150 150)') },
  arch: { label: 'Arch', group: 'Geometry', kind: 'svg', viewBox: [230, 290], ratio: 230 / 290, svg: fillPath('M10 282 V115 A105 105 0 0 1 220 115 V282 Z') },
  'capsule-side': { label: 'Half capsule', group: 'Geometry', kind: 'svg', viewBox: [300, 210], ratio: 300 / 210, svg: fillPath('M12 12 H200 A93 93 0 0 1 200 198 H12 Z') },
  'diamond-tall': { label: 'Tall diamond', group: 'Geometry', kind: 'svg', viewBox: [200, 300], ratio: 200 / 300, svg: fillPoly('100,8 192,150 100,292 8,150') },
  'hexagon-flat': { label: 'Hexagon (flat)', group: 'Geometry', kind: 'svg', viewBox: [300, 260], ratio: 300 / 260, svg: fillPoly(polyPts(6, 150, 130, 145, 0)) },
  donut: { label: 'Donut', group: 'Geometry', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: evenOdd(circleD(150, 150, 142) + circleD(150, 150, 74)) },
  'half-ring': { label: 'Half ring', group: 'Geometry', kind: 'svg', viewBox: [300, 160], ratio: 300 / 160, svg: fillPath('M10 150 A140 140 0 0 1 290 150 L224 150 A74 74 0 0 0 76 150 Z') },

  /* ---------------- Stars & Bursts ---------------- */
  star4: { label: '4-point star', group: 'Stars & Bursts', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: fillPoly(starPts(4, 0.42)) },
  star6: { label: '6-point star', group: 'Stars & Bursts', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: fillPoly(starPts(6, 0.55)) },
  star7: { label: '7-point star', group: 'Stars & Bursts', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: fillPoly(starPts(7, 0.52)) },
  star8: { label: '8-point star', group: 'Stars & Bursts', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: fillPoly(starPts(8, 0.48)) },
  star10: { label: '10-point star', group: 'Stars & Bursts', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: fillPoly(starPts(10, 0.62)) },
  star12: { label: '12-point star', group: 'Stars & Bursts', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: fillPoly(starPts(12, 0.68)) },
  star16: { label: '16-point star', group: 'Stars & Bursts', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: fillPoly(starPts(16, 0.74)) },
  'star4-thin': { label: 'Thin 4-star', group: 'Stars & Bursts', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: fillPoly(starPts(4, 0.16)) },
  'star5-thin': { label: 'Thin 5-star', group: 'Stars & Bursts', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: fillPoly(starPts(5, 0.26)) },
  'star8-thin': { label: 'Thin 8-star', group: 'Stars & Bursts', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: fillPoly(starPts(8, 0.3)) },
  burst8: { label: 'Burst 8', group: 'Stars & Bursts', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: fillPoly(starPts(8, 0.7)) },
  burst10: { label: 'Burst 10', group: 'Stars & Bursts', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: fillPoly(starPts(10, 0.74)) },
  burst16: { label: 'Burst 16', group: 'Stars & Bursts', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: fillPoly(starPts(16, 0.8)) },
  burst20: { label: 'Burst 20', group: 'Stars & Bursts', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: fillPoly(starPts(20, 0.84)) },
  burst24: { label: 'Burst 24', group: 'Stars & Bursts', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: fillPoly(starPts(24, 0.86)) },
  seal8: { label: 'Seal 8', group: 'Stars & Bursts', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: fillPath(sealD(8)) },
  seal10: { label: 'Seal 10', group: 'Stars & Bursts', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: fillPath(sealD(10)) },
  seal14: { label: 'Seal 14', group: 'Stars & Bursts', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: fillPath(sealD(14)) },
  seal16: { label: 'Seal 16', group: 'Stars & Bursts', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: fillPath(sealD(16)) },
  'sparkle-soft': { label: 'Soft sparkle', group: 'Stars & Bursts', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: fillPath('M150 8 Q162 138 292 150 Q162 162 150 292 Q138 162 8 150 Q138 138 150 8 Z') },
  asterisk5: { label: 'Asterisk 5', group: 'Stars & Bursts', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: asterisk(5) },
  asterisk6: { label: 'Asterisk 6', group: 'Stars & Bursts', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: asterisk(6) },
  asterisk8: { label: 'Asterisk 8', group: 'Stars & Bursts', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: asterisk(8, 28) },

  /* ---------------- Arrows ---------------- */
  'arrow-right': { label: 'Arrow right', group: 'Arrows', kind: 'svg', viewBox: [300, 200], ratio: 1.5, svg: fillPoly('12,72 160,72 160,18 288,100 160,182 160,128 12,128') },
  'arrow-left': { label: 'Arrow left', group: 'Arrows', kind: 'svg', viewBox: [300, 200], ratio: 1.5, svg: fillPoly('288,72 140,72 140,18 12,100 140,182 140,128 288,128') },
  'arrow-up': { label: 'Arrow up', group: 'Arrows', kind: 'svg', viewBox: [200, 300], ratio: 200 / 300, svg: fillPoly('72,288 72,140 18,140 100,12 182,140 128,140 128,288') },
  'arrow-down': { label: 'Arrow down', group: 'Arrows', kind: 'svg', viewBox: [200, 300], ratio: 200 / 300, svg: fillPoly('72,12 72,160 18,160 100,288 182,160 128,160 128,12') },
  'arrow-double-h': { label: 'Double arrow', group: 'Arrows', kind: 'svg', viewBox: [300, 200], ratio: 1.5, svg: fillPoly('88,45 88,75 212,75 212,45 288,100 212,155 212,125 88,125 88,155 12,100') },
  'arrow-double-v': { label: 'Double arrow V', group: 'Arrows', kind: 'svg', viewBox: [200, 300], ratio: 200 / 300, svg: fillPoly('100,12 155,88 125,88 125,212 155,212 100,288 45,212 75,212 75,88 45,88') },
  'chevron-right': { label: 'Chevron right', group: 'Arrows', kind: 'svg', viewBox: [240, 280], ratio: 240 / 280, svg: fillPoly('8,8 118,8 232,140 118,272 8,272 122,140') },
  'chevron-left': { label: 'Chevron left', group: 'Arrows', kind: 'svg', viewBox: [240, 280], ratio: 240 / 280, svg: fillPoly('232,8 122,8 8,140 122,272 232,272 118,140') },
  'chevrons-double': {
    label: 'Double chevrons', group: 'Arrows', kind: 'svg', viewBox: [300, 280], ratio: 300 / 280,
    svg: (_w, _h, p) =>
      `<polygon points="10,8 78,8 190,140 78,272 10,272 122,140" fill="${p.fill}"/>` +
      `<polygon points="120,8 188,8 300,140 188,272 120,272 232,140" fill="${p.fill}"/>`,
  },
  'chevrons-triple': {
    label: 'Triple chevrons', group: 'Arrows', kind: 'svg', viewBox: [300, 280], ratio: 300 / 280,
    svg: (_w, _h, p) => {
      const out: string[] = []
      for (let k = 0; k < 3; k++) {
        const x = 12 + k * 80
        out.push(`<polygon points="${x},8 ${x + 40},8 ${x + 128},140 ${x + 40},272 ${x},272 ${x + 88},140" fill="${p.fill}"/>`)
      }
      return out.join('')
    },
  },
  'arrow-bent': { label: 'Bent arrow', group: 'Arrows', kind: 'svg', viewBox: [300, 300], ratio: 1, strokeBased: true, svg: strokePath('M60 268 V130 Q60 62 128 62 H240 M240 62 L192 30 M240 62 L192 94') },
  'arrow-uturn': { label: 'U-turn arrow', group: 'Arrows', kind: 'svg', viewBox: [300, 300], ratio: 1, strokeBased: true, svg: strokePath('M85 268 V125 A65 65 0 0 1 215 125 V235 M215 235 L177 190 M215 235 L253 190') },
  'arrow-curve': { label: 'Curved arrow', group: 'Arrows', kind: 'svg', viewBox: [300, 300], ratio: 1, strokeBased: true, svg: strokePath('M35 262 C35 120 120 48 250 48 M250 48 L198 22 M250 48 L204 88') },
  'arrow-diagonal': { label: 'Diagonal arrow', group: 'Arrows', kind: 'svg', viewBox: [300, 300], ratio: 1, strokeBased: true, svg: strokePath('M45 255 L250 50 M250 50 H182 M250 50 V118') },
  'arrow-refresh': { label: 'Refresh arrow', group: 'Arrows', kind: 'svg', viewBox: [300, 300], ratio: 1, strokeBased: true, svg: strokePath('M255 150 A105 105 0 1 1 224 76 M224 76 L172 64 M224 76 L211 128') },
  cursor: { label: 'Cursor', group: 'Arrows', kind: 'svg', viewBox: [190, 270], ratio: 190 / 270, svg: fillPoly('5,5 5,225 65,170 105,260 145,240 105,155 180,150') },
  dart: { label: 'Dart', group: 'Arrows', kind: 'svg', viewBox: [250, 270], ratio: 250 / 270, svg: fillPoly('10,135 240,25 190,135 240,245') },

  /* ---------------- Callouts ---------------- */
  'bubble-round': {
    label: 'Round bubble', group: 'Callouts', kind: 'svg', viewBox: [300, 285], ratio: 300 / 285,
    svg: parts(fillEllipse(150, 122, 138, 108), fillPoly('92,208 66,278 148,222')),
  },
  'thought-cloud': {
    label: 'Thought cloud', group: 'Callouts', kind: 'svg', viewBox: [300, 285], ratio: 300 / 285,
    svg: parts(
      fillCircle(95, 105, 52), fillCircle(158, 82, 60), fillCircle(215, 118, 46),
      fillCircle(150, 148, 58), fillCircle(98, 150, 44),
      fillCircle(80, 222, 17), fillCircle(52, 258, 10)
    ),
  },
  'shout-bubble': {
    label: 'Shout bubble', group: 'Callouts', kind: 'svg', viewBox: [300, 290], ratio: 300 / 290,
    svg: parts(fillPoly(starPts(14, 0.74, 150, 132, 130)), fillPoly('108,235 84,285 150,242')),
  },
  'callout-left': {
    label: 'Callout left', group: 'Callouts', kind: 'svg', viewBox: [300, 275], ratio: 300 / 275,
    svg: parts(fillRect(12, 12, 276, 188, 26), fillPoly('62,196 52,272 128,196')),
  },
  'callout-right': {
    label: 'Callout right', group: 'Callouts', kind: 'svg', viewBox: [300, 275], ratio: 300 / 275,
    svg: parts(fillRect(12, 12, 276, 188, 26), fillPoly('238,196 248,272 172,196')),
  },
  'chat-dots': {
    label: 'Chat dots', group: 'Callouts', kind: 'svg', viewBox: [300, 270], ratio: 300 / 270,
    svg: evenOdd(
      'M44 14 H256 A28 28 0 0 1 284 42 V170 A28 28 0 0 1 256 198 H132 L58 262 L76 198 H44 A28 28 0 0 1 16 170 V42 A28 28 0 0 1 44 14 Z ' +
      circleD(84, 106, 15) + circleD(150, 106, 15) + circleD(216, 106, 15)
    ),
  },

  /* ---------------- Badges & Banners ---------------- */
  shield: { label: 'Shield', group: 'Badges & Banners', kind: 'svg', viewBox: [300, 300], ratio: 0.88, svg: fillPath('M150 12 L272 52 V148 C272 224 222 268 150 288 C78 268 28 224 28 148 V52 Z') },
  'shield-round': { label: 'Round shield', group: 'Badges & Banners', kind: 'svg', viewBox: [300, 300], ratio: 0.88, svg: fillPath('M150 10 C192 40 236 48 274 46 V158 C274 232 216 272 150 290 C84 272 26 232 26 158 V46 C64 48 108 40 150 10 Z') },
  'shield-badge': { label: 'Badge shield', group: 'Badges & Banners', kind: 'svg', viewBox: [300, 300], ratio: 0.9, svg: fillPoly('28,25 272,25 272,185 150,283 28,185') },
  ribbon: { label: 'Ribbon', group: 'Badges & Banners', kind: 'svg', viewBox: [300, 150], ratio: 2, svg: fillPoly('6,6 294,6 252,75 294,144 6,144 48,75') },
  banner: {
    label: 'Banner', group: 'Badges & Banners', kind: 'svg', viewBox: [300, 190], ratio: 300 / 190,
    svg: parts(
      fillPoly('8,62 50,62 50,152 8,152 28,107'),
      fillPoly('292,62 250,62 250,152 292,152 272,107'),
      fillRect(42, 35, 216, 120, 8)
    ),
  },
  'banner-flag': { label: 'Hanging banner', group: 'Badges & Banners', kind: 'svg', viewBox: [230, 290], ratio: 230 / 290, svg: fillPath('M12 10 H218 V282 L115 226 L12 282 Z') },
  'flag-wave': {
    label: 'Waving flag', group: 'Badges & Banners', kind: 'svg', viewBox: [300, 300], ratio: 1,
    svg: parts(
      fillRect(26, 10, 14, 280, 7),
      fillPath('M48 28 C95 8 132 48 182 30 C216 18 246 22 272 34 V150 C246 138 216 134 182 146 C132 164 95 124 48 144 Z')
    ),
  },
  pennant: {
    label: 'Pennant', group: 'Badges & Banners', kind: 'svg', viewBox: [300, 300], ratio: 1,
    svg: parts(fillRect(20, 8, 13, 284, 6), fillPoly('41,26 282,80 41,134')),
  },
  bookmark: { label: 'Bookmark', group: 'Badges & Banners', kind: 'svg', viewBox: [200, 290], ratio: 200 / 290, svg: fillPath('M12 10 H188 V282 L100 218 L12 282 Z') },
  tag: {
    label: 'Tag', group: 'Badges & Banners', kind: 'svg', viewBox: [300, 300], ratio: 1,
    svg: evenOdd(
      'M155 12 H262 A26 26 0 0 1 288 38 V145 L163 270 A28 28 0 0 1 123 270 L30 177 A28 28 0 0 1 30 137 Z ' +
      circleD(228, 72, 22)
    ),
  },
  pin: {
    label: 'Map pin', group: 'Badges & Banners', kind: 'svg', viewBox: [300, 300], ratio: 0.79,
    svg: evenOdd('M150 288 C150 288 42 172 42 112 A108 104 0 0 1 258 112 C258 172 150 288 150 288 Z ' + circleD(150, 112, 42)),
  },
  'pin-round': {
    label: 'Push pin', group: 'Badges & Banners', kind: 'svg', viewBox: [170, 300], ratio: 170 / 300,
    svg: parts(fillCircle(85, 88, 78), fillPoly('77,162 93,162 87,292 83,292')),
  },
  rosette: {
    label: 'Rosette', group: 'Badges & Banners', kind: 'svg', viewBox: [300, 300], ratio: 1,
    svg: parts(
      fillPoly('108,168 72,282 130,232'),
      fillPoly('192,168 228,282 170,232'),
      (_w, _h, p) => `<path d="${sealD(12, 150, 105, 78, 110)}" fill="${p.fill}"/>`
    ),
  },
  medal: {
    label: 'Medal', group: 'Badges & Banners', kind: 'svg', viewBox: [300, 290], ratio: 300 / 290,
    svg: parts(fillPoly('92,8 150,118 208,8 252,8 172,160 128,160 48,8'), fillCircle(150, 205, 76)),
  },
  ticket: { label: 'Ticket', group: 'Badges & Banners', kind: 'svg', viewBox: [300, 190], ratio: 300 / 190, svg: fillPath('M14 10 H286 V66 A30 30 0 0 0 286 126 V180 H14 V126 A30 30 0 0 0 14 66 Z') },

  /* ---------------- Nature ---------------- */
  flower4: { label: 'Flower 4', group: 'Nature', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: flower(4, 52, 78) },
  flower5: { label: 'Flower 5', group: 'Nature', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: flower(5, 46, 74) },
  flower6: { label: 'Flower 6', group: 'Nature', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: flower(6, 42, 72) },
  flower8: { label: 'Flower 8', group: 'Nature', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: flower(8, 34, 70) },
  flower12: { label: 'Flower 12', group: 'Nature', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: flower(12, 24, 68) },
  clover3: {
    label: 'Clover 3', group: 'Nature', kind: 'svg', viewBox: [300, 300], ratio: 1,
    svg: (_w, _h, p) => {
      const out: string[] = []
      for (let i = 0; i < 3; i++) {
        const a = ((-90 + i * 120) * Math.PI) / 180
        out.push(`<circle cx="${N(150 + Math.cos(a) * 58)}" cy="${N(140 + Math.sin(a) * 58)}" r="64" fill="${p.fill}"/>`)
      }
      out.push(`<polygon points="144,195 156,195 164,288 136,288" fill="${p.fill}"/>`)
      return out.join('')
    },
  },
  clover4: {
    label: 'Clover 4', group: 'Nature', kind: 'svg', viewBox: [300, 300], ratio: 1,
    svg: (_w, _h, p) => {
      const out: string[] = []
      for (let i = 0; i < 4; i++) {
        const a = ((45 + i * 90) * Math.PI) / 180
        out.push(`<circle cx="${N(150 + Math.cos(a) * 62)}" cy="${N(150 + Math.sin(a) * 62)}" r="66" fill="${p.fill}"/>`)
      }
      return out.join('')
    },
  },
  leaf: { label: 'Leaf', group: 'Nature', kind: 'svg', viewBox: [300, 300], ratio: 0.85, svg: fillPath('M150 12 C258 58 276 198 150 288 C24 198 42 58 150 12 Z') },
  'tree-pine': {
    label: 'Pine tree', group: 'Nature', kind: 'svg', viewBox: [300, 300], ratio: 0.75,
    svg: parts(
      fillPoly('150,8 218,105 82,105'),
      fillPoly('150,70 236,185 64,185'),
      fillPoly('150,140 255,265 45,265'),
      fillRect(132, 265, 36, 30)
    ),
  },
  'tree-round': {
    label: 'Round tree', group: 'Nature', kind: 'svg', viewBox: [300, 300], ratio: 0.68,
    svg: parts(fillCircle(150, 112, 98), fillRect(134, 200, 32, 88, 8)),
  },
  cloud: {
    label: 'Cloud', group: 'Nature', kind: 'svg', viewBox: [300, 200], ratio: 1.5,
    svg: parts(fillCircle(85, 130, 52), fillCircle(150, 95, 64), fillCircle(218, 128, 48), fillRect(60, 128, 196, 64, 32)),
  },
  sun: {
    label: 'Sun', group: 'Nature', kind: 'svg', viewBox: [300, 300], ratio: 1,
    svg: (_w, _h, p) => {
      const out: string[] = [`<circle cx="150" cy="150" r="70" fill="${p.fill}"/>`]
      for (let i = 0; i < 12; i++)
        out.push(`<rect x="141" y="10" width="18" height="46" rx="9" fill="${p.fill}" transform="rotate(${i * 30} 150 150)"/>`)
      return out.join('')
    },
  },
  snowflake: {
    label: 'Snowflake', group: 'Nature', kind: 'svg', viewBox: [300, 300], ratio: 1, strokeBased: true,
    svg: (_w, _h, p) => {
      const arm = 'M150 150 V28 M150 62 L118 34 M150 62 L182 34 M150 108 L122 82 M150 108 L178 82'
      const out: string[] = []
      for (let i = 0; i < 6; i++)
        out.push(`<path d="${arm}" transform="rotate(${i * 60} 150 150)"/>`)
      return `<g stroke="${p.accent}" stroke-width="${p.strokeWidth}" fill="none" stroke-linecap="round">${out.join('')}</g>`
    },
  },
  mountain: { label: 'Mountain', group: 'Nature', kind: 'svg', viewBox: [300, 220], ratio: 300 / 220, svg: fillPoly('8,212 108,28 160,108 202,52 292,212') },
  flame: { label: 'Flame', group: 'Nature', kind: 'svg', viewBox: [300, 300], ratio: 0.75, svg: fillPath('M150 10 C176 66 232 108 240 178 A92 96 0 0 1 60 178 C64 130 96 108 108 58 C122 92 134 96 150 10 Z') },
  planet: {
    label: 'Planet', group: 'Nature', kind: 'svg', viewBox: [300, 300], ratio: 1,
    svg: (_w, _h, p) =>
      `<circle cx="150" cy="150" r="88" fill="${p.fill}"/>` +
      `<ellipse cx="150" cy="150" rx="140" ry="34" fill="none" stroke="${p.accent}" stroke-width="${Math.max(8, p.strokeWidth)}" transform="rotate(-18 150 150)"/>`,
  },

  /* ---------------- Symbols ---------------- */
  'check-bold': { label: 'Bold check', group: 'Symbols', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: fillPoly('22,158 62,116 114,168 238,42 278,84 114,252') },
  'heart-outline': { label: 'Heart outline', group: 'Symbols', kind: 'svg', viewBox: [300, 290], ratio: 300 / 290, strokeBased: true, svg: strokePath('M150 258 C150 258 38 184 38 106 C38 62 72 32 108 32 C126 32 142 40 150 54 C158 40 174 32 192 32 C228 32 262 62 262 106 C262 184 150 258 150 258 Z') },
  exclamation: {
    label: 'Exclamation', group: 'Symbols', kind: 'svg', viewBox: [110, 300], ratio: 110 / 300,
    svg: parts(fillRect(30, 10, 50, 190, 25), fillCircle(55, 262, 30)),
  },
  question: {
    label: 'Question', group: 'Symbols', kind: 'svg', viewBox: [220, 300], ratio: 220 / 300, strokeBased: true,
    svg: (_w, _h, p) =>
      `<path d="M28 88 C28 42 62 14 110 14 C158 14 192 42 192 88 C192 158 110 132 110 205" stroke="${p.accent}" stroke-width="${Math.max(18, p.strokeWidth)}" fill="none" stroke-linecap="round"/>` +
      `<circle cx="110" cy="268" r="21" fill="${p.accent}"/>`,
  },
  hashtag: { label: 'Hashtag', group: 'Symbols', kind: 'svg', viewBox: [300, 300], ratio: 1, strokeBased: true, svg: strokePath('M112 30 L88 270 M212 30 L188 270 M40 105 H265 M35 195 H260') },
  infinity: { label: 'Infinity', group: 'Symbols', kind: 'svg', viewBox: [300, 170], ratio: 300 / 170, strokeBased: true, svg: strokePath('M150 85 C118 30 15 30 15 85 C15 140 118 140 150 85 C182 30 285 30 285 85 C285 140 182 140 150 85 Z') },
  peace: {
    label: 'Peace', group: 'Symbols', kind: 'svg', viewBox: [300, 300], ratio: 1, strokeBased: true,
    svg: (_w, _h, p) =>
      `<circle cx="150" cy="150" r="130" stroke="${p.accent}" stroke-width="${p.strokeWidth}" fill="none"/>` +
      `<path d="M150 20 V280 M150 150 L58 242 M150 150 L242 242" stroke="${p.accent}" stroke-width="${p.strokeWidth}" fill="none" stroke-linecap="round"/>`,
  },
  paw: {
    label: 'Paw print', group: 'Symbols', kind: 'svg', viewBox: [300, 300], ratio: 1,
    svg: parts(
      fillEllipse(150, 200, 72, 58),
      fillEllipse(66, 118, 28, 36, -18),
      fillEllipse(126, 82, 28, 38),
      fillEllipse(186, 86, 28, 38, 8),
      fillEllipse(240, 130, 26, 33, 22)
    ),
  },
  smiley: {
    label: 'Smiley', group: 'Symbols', kind: 'svg', viewBox: [300, 300], ratio: 1, strokeBased: true,
    svg: (_w, _h, p) =>
      `<circle cx="150" cy="150" r="122" stroke="${p.accent}" stroke-width="${p.strokeWidth}" fill="none"/>` +
      `<circle cx="104" cy="112" r="15" fill="${p.accent}"/><circle cx="196" cy="112" r="15" fill="${p.accent}"/>` +
      `<path d="M88 178 Q150 238 212 178" stroke="${p.accent}" stroke-width="${p.strokeWidth}" fill="none" stroke-linecap="round"/>`,
  },
  power: { label: 'Power', group: 'Symbols', kind: 'svg', viewBox: [300, 300], ratio: 1, strokeBased: true, svg: strokePath('M150 24 V150 M204 57 A108 108 0 1 1 96 57') },
  male: {
    label: 'Male', group: 'Symbols', kind: 'svg', viewBox: [300, 300], ratio: 1, strokeBased: true,
    svg: (_w, _h, p) =>
      `<circle cx="118" cy="182" r="80" stroke="${p.accent}" stroke-width="${p.strokeWidth}" fill="none"/>` +
      `<path d="M175 125 L268 32 M268 32 H198 M268 32 V102" stroke="${p.accent}" stroke-width="${p.strokeWidth}" fill="none" stroke-linecap="round"/>`,
  },
  female: {
    label: 'Female', group: 'Symbols', kind: 'svg', viewBox: [220, 300], ratio: 220 / 300, strokeBased: true,
    svg: (_w, _h, p) =>
      `<circle cx="110" cy="92" r="74" stroke="${p.accent}" stroke-width="${p.strokeWidth}" fill="none"/>` +
      `<path d="M110 166 V282 M62 228 H158" stroke="${p.accent}" stroke-width="${p.strokeWidth}" fill="none" stroke-linecap="round"/>`,
  },
  'notes-double': {
    label: 'Music notes', group: 'Symbols', kind: 'svg', viewBox: [300, 290], ratio: 300 / 290,
    svg: parts(
      fillEllipse(78, 252, 32, 24),
      fillEllipse(222, 230, 32, 24),
      fillRect(98, 62, 12, 190),
      fillRect(242, 40, 12, 190),
      fillPoly('98,62 254,40 254,84 98,106')
    ),
  },
  spade: { label: 'Spade', group: 'Symbols', kind: 'svg', viewBox: [300, 300], ratio: 0.87, svg: fillPath('M150 10 C192 72 268 100 268 164 A62 60 0 0 1 163 208 C168 244 184 264 198 282 H102 C116 264 132 244 137 208 A62 60 0 0 1 32 164 C32 100 108 72 150 10 Z') },
  club: {
    label: 'Club', group: 'Symbols', kind: 'svg', viewBox: [300, 300], ratio: 1,
    svg: parts(fillCircle(150, 88, 58), fillCircle(88, 190, 58), fillCircle(212, 190, 58), fillPoly('138,208 162,208 188,285 112,285')),
  },
  quote: {
    label: 'Quote marks', group: 'Symbols', kind: 'svg', viewBox: [300, 220], ratio: 300 / 220,
    svg: parts(
      fillRect(30, 12, 86, 96, 26), fillPoly('44,95 116,95 60,208'),
      fillRect(170, 12, 86, 96, 26), fillPoly('184,95 256,95 200,208')
    ),
  },
  ellipsis: {
    label: 'Ellipsis', group: 'Symbols', kind: 'svg', viewBox: [300, 80], ratio: 300 / 80,
    svg: parts(fillCircle(40, 40, 30), fillCircle(150, 40, 30), fillCircle(260, 40, 30)),
  },
  equals: {
    label: 'Equals', group: 'Symbols', kind: 'svg', viewBox: [300, 180], ratio: 300 / 180,
    svg: parts(fillRect(18, 22, 264, 52, 26), fillRect(18, 106, 264, 52, 26)),
  },
  percent: {
    label: 'Percent', group: 'Symbols', kind: 'svg', viewBox: [300, 300], ratio: 1,
    svg: parts(
      evenOdd(circleD(80, 78, 52) + circleD(80, 78, 26) + circleD(220, 222, 52) + circleD(220, 222, 26)),
      fillPoly('212,22 248,22 88,278 52,278')
    ),
  },

  /* ---------------- Icons ---------------- */
  eye: {
    label: 'Eye', group: 'Icons', kind: 'svg', viewBox: [300, 190], ratio: 300 / 190, strokeBased: true,
    svg: (_w, _h, p) =>
      `<path d="M10 95 C68 12 232 12 290 95 C232 178 68 178 10 95 Z" stroke="${p.accent}" stroke-width="${p.strokeWidth}" fill="none" stroke-linejoin="round"/>` +
      `<circle cx="150" cy="95" r="46" fill="${p.accent}"/>`,
  },
  target: { label: 'Target', group: 'Icons', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: evenOdd(circleD(150, 150, 142) + circleD(150, 150, 100) + circleD(150, 150, 54)) },
  clock: {
    label: 'Clock', group: 'Icons', kind: 'svg', viewBox: [300, 300], ratio: 1,
    svg: parts(
      evenOdd(circleD(150, 150, 140) + circleD(150, 150, 116)),
      fillRect(143, 70, 14, 90, 7),
      fillRect(150, 143, 72, 14, 7)
    ),
  },
  hourglass: { label: 'Hourglass', group: 'Icons', kind: 'svg', viewBox: [300, 300], ratio: 0.65, svg: fillPath('M62 16 H238 V58 C238 102 176 122 176 150 C176 178 238 198 238 242 V284 H62 V242 C62 198 124 178 124 150 C124 122 62 102 62 58 Z') },
  bell: {
    label: 'Bell', group: 'Icons', kind: 'svg', viewBox: [300, 300], ratio: 1,
    svg: parts(fillPath('M150 16 C206 16 240 62 240 128 V192 L268 232 H32 L60 192 V128 C60 62 94 16 150 16 Z'), fillCircle(150, 262, 24)),
  },
  lock: {
    label: 'Lock', group: 'Icons', kind: 'svg', viewBox: [300, 300], ratio: 0.86,
    svg: (_w, _h, p) =>
      `<rect x="52" y="128" width="196" height="152" rx="24" fill="${p.fill}"/>` +
      `<path d="M95 128 V92 A55 55 0 0 1 205 92 V128" stroke="${p.accent}" stroke-width="26" fill="none" stroke-linecap="round"/>`,
  },
  home: { label: 'Home', group: 'Icons', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: fillPoly('150,12 288,138 240,138 240,282 172,282 172,198 128,198 128,282 60,282 60,138 12,138') },
  envelope: {
    label: 'Envelope', group: 'Icons', kind: 'svg', viewBox: [300, 220], ratio: 300 / 220, strokeBased: true,
    svg: (_w, _h, p) =>
      `<rect x="14" y="14" width="272" height="192" rx="20" stroke="${p.accent}" stroke-width="${p.strokeWidth}" fill="none"/>` +
      `<path d="M20 24 L150 128 L280 24" stroke="${p.accent}" stroke-width="${p.strokeWidth}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  camera: {
    label: 'Camera', group: 'Icons', kind: 'svg', viewBox: [300, 250], ratio: 300 / 250,
    svg: parts(
      evenOdd(
        'M10 88 A26 26 0 0 1 36 62 H98 L116 28 H184 L202 62 H264 A26 26 0 0 1 290 88 V214 A26 26 0 0 1 264 240 H36 A26 26 0 0 1 10 214 Z ' +
        circleD(150, 148, 58)
      ),
      fillCircle(150, 148, 30)
    ),
  },
  monitor: {
    label: 'Monitor', group: 'Icons', kind: 'svg', viewBox: [300, 270], ratio: 300 / 270,
    svg: parts(
      evenOdd(roundRectD(10, 10, 280, 180, 20) + roundRectD(34, 34, 232, 132, 8)),
      fillRect(132, 190, 36, 38),
      fillRect(84, 228, 132, 22, 11)
    ),
  },
  smartphone: {
    label: 'Phone', group: 'Icons', kind: 'svg', viewBox: [170, 300], ratio: 170 / 300,
    svg: parts(
      evenOdd(roundRectD(10, 8, 150, 284, 30) + roundRectD(26, 44, 118, 196, 6)),
      fillCircle(85, 266, 13)
    ),
  },
  bulb: {
    label: 'Light bulb', group: 'Icons', kind: 'svg', viewBox: [220, 300], ratio: 220 / 300,
    svg: parts(
      fillCircle(110, 102, 92),
      fillPoly('78,182 142,182 136,214 84,214'),
      fillRect(80, 222, 60, 18, 9),
      fillRect(88, 248, 44, 16, 8)
    ),
  },
  battery: {
    label: 'Battery', group: 'Icons', kind: 'svg', viewBox: [300, 160], ratio: 300 / 160,
    svg: parts(
      evenOdd(roundRectD(8, 20, 252, 120, 22) + roundRectD(28, 40, 212, 80, 10)),
      fillRect(268, 55, 24, 50, 8),
      fillRect(44, 54, 54, 52, 8),
      fillRect(112, 54, 54, 52, 8)
    ),
  },
  wifi: {
    label: 'Wi-Fi', group: 'Icons', kind: 'svg', viewBox: [300, 300], ratio: 1, strokeBased: true,
    svg: (_w, _h, p) =>
      `<path d="M35 128 A160 160 0 0 1 265 128 M78 178 A105 105 0 0 1 222 178 M122 228 A48 48 0 0 1 178 228" stroke="${p.accent}" stroke-width="${Math.max(16, p.strokeWidth)}" fill="none" stroke-linecap="round"/>` +
      `<circle cx="150" cy="272" r="20" fill="${p.accent}"/>`,
  },
  'signal-bars': {
    label: 'Signal bars', group: 'Icons', kind: 'svg', viewBox: [300, 260], ratio: 300 / 260,
    svg: parts(fillRect(16, 180, 52, 70, 10), fillRect(90, 140, 52, 110, 10), fillRect(164, 92, 52, 158, 10), fillRect(238, 36, 52, 214, 10)),
  },
  volume: {
    label: 'Volume', group: 'Icons', kind: 'svg', viewBox: [300, 300], ratio: 1,
    svg: (_w, _h, p) =>
      `<polygon points="16,105 82,105 158,40 158,260 82,195 16,195" fill="${p.fill}"/>` +
      `<path d="M196 108 A55 55 0 0 1 196 192 M228 72 A102 102 0 0 1 228 228" stroke="${p.accent}" stroke-width="${Math.max(16, p.strokeWidth)}" fill="none" stroke-linecap="round"/>`,
  },
  mic: {
    label: 'Microphone', group: 'Icons', kind: 'svg', viewBox: [230, 300], ratio: 230 / 300,
    svg: (_w, _h, p) =>
      `<rect x="75" y="12" width="80" height="160" rx="40" fill="${p.fill}"/>` +
      `<path d="M25 130 A90 90 0 0 0 205 130" stroke="${p.accent}" stroke-width="${Math.max(16, p.strokeWidth)}" fill="none" stroke-linecap="round"/>` +
      `<rect x="107" y="222" width="16" height="36" fill="${p.fill}"/><rect x="70" y="262" width="90" height="16" rx="8" fill="${p.fill}"/>`,
  },
  headphones: {
    label: 'Headphones', group: 'Icons', kind: 'svg', viewBox: [300, 285], ratio: 300 / 285, strokeBased: true,
    svg: (_w, _h, p) =>
      `<path d="M40 190 V150 A110 110 0 0 1 260 150 V190" stroke="${p.accent}" stroke-width="${Math.max(18, p.strokeWidth)}" fill="none" stroke-linecap="round"/>` +
      `<rect x="24" y="182" width="52" height="92" rx="22" fill="${p.accent}"/><rect x="224" y="182" width="52" height="92" rx="22" fill="${p.accent}"/>`,
  },
  gift: {
    label: 'Gift', group: 'Icons', kind: 'svg', viewBox: [300, 300], ratio: 1,
    svg: parts(
      evenOdd(roundRectD(38, 132, 224, 154, 12) + roundRectD(128, 132, 8, 154) + roundRectD(164, 132, 8, 154)),
      evenOdd(roundRectD(22, 84, 256, 42, 14) + roundRectD(128, 84, 8, 42) + roundRectD(164, 84, 8, 42)),
      fillEllipse(118, 62, 30, 20, -20),
      fillEllipse(182, 62, 30, 20, 20)
    ),
  },
  trophy: {
    label: 'Trophy', group: 'Icons', kind: 'svg', viewBox: [300, 300], ratio: 1,
    svg: (_w, _h, p) =>
      `<path d="M72 20 H228 V112 C228 170 194 204 150 204 C106 204 72 170 72 112 Z" fill="${p.fill}"/>` +
      `<path d="M72 48 H38 A44 44 0 0 0 80 116 M228 48 H262 A44 44 0 0 1 220 116" stroke="${p.accent}" stroke-width="18" fill="none" stroke-linecap="round"/>` +
      `<rect x="136" y="204" width="28" height="34" fill="${p.fill}"/><rect x="92" y="240" width="116" height="26" rx="8" fill="${p.fill}"/>`,
  },
  gem: { label: 'Gem', group: 'Icons', kind: 'svg', viewBox: [300, 290], ratio: 1, svg: fillPoly('78,22 222,22 284,102 150,282 16,102') },
  coin: { label: 'Coin', group: 'Icons', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: evenOdd(circleD(150, 150, 142) + circleD(150, 150, 118) + circleD(150, 150, 96)) },
  'paper-plane': {
    label: 'Paper plane', group: 'Icons', kind: 'svg', viewBox: [300, 300], ratio: 1,
    svg: parts(fillPoly('288,16 14,148 112,182'), fillPoly('288,16 130,200 136,282 178,220')),
  },
  anchor: {
    label: 'Anchor', group: 'Icons', kind: 'svg', viewBox: [300, 300], ratio: 1, strokeBased: true,
    svg: (_w, _h, p) =>
      `<circle cx="150" cy="50" r="28" stroke="${p.accent}" stroke-width="${p.strokeWidth}" fill="none"/>` +
      `<path d="M150 78 V242 M92 118 H208 M42 178 A108 108 0 0 0 258 178 M42 178 L20 152 M42 178 L72 162 M258 178 L280 152 M258 178 L228 162" stroke="${p.accent}" stroke-width="${p.strokeWidth}" fill="none" stroke-linecap="round"/>`,
  },
  compass: {
    label: 'Compass', group: 'Icons', kind: 'svg', viewBox: [300, 300], ratio: 1,
    svg: parts(
      evenOdd(circleD(150, 150, 140) + circleD(150, 150, 114)),
      (_w, _h, p) => `<polygon points="150,62 186,150 150,238 114,150" fill="${p.fill}" transform="rotate(38 150 150)"/>`
    ),
  },
  globe: {
    label: 'Globe', group: 'Icons', kind: 'svg', viewBox: [300, 300], ratio: 1, strokeBased: true,
    svg: (_w, _h, p) =>
      `<circle cx="150" cy="150" r="128" stroke="${p.accent}" stroke-width="${p.strokeWidth}" fill="none"/>` +
      `<ellipse cx="150" cy="150" rx="56" ry="128" stroke="${p.accent}" stroke-width="${p.strokeWidth}" fill="none"/>` +
      `<path d="M22 150 H278 M40 92 Q150 140 260 92 M40 208 Q150 160 260 208" stroke="${p.accent}" stroke-width="${p.strokeWidth}" fill="none" stroke-linecap="round"/>`,
  },
  folder: { label: 'Folder', group: 'Icons', kind: 'svg', viewBox: [300, 250], ratio: 300 / 250, svg: fillPath('M14 62 A22 22 0 0 1 36 40 H112 L144 76 H264 A22 22 0 0 1 286 98 V216 A22 22 0 0 1 264 238 H36 A22 22 0 0 1 14 216 Z') },
  document: {
    label: 'Document', group: 'Icons', kind: 'svg', viewBox: [230, 300], ratio: 230 / 300,
    svg: evenOdd(
      'M30 8 H150 L220 78 V270 A22 22 0 0 1 198 292 H32 A22 22 0 0 1 10 270 V30 A22 22 0 0 1 30 8 Z ' +
      'M150 8 L220 78 L150 78 Z ' +
      roundRectD(48, 140, 134, 16, 8) + roundRectD(48, 180, 134, 16, 8) + roundRectD(48, 220, 86, 16, 8)
    ),
  },
  pencil: { label: 'Pencil', group: 'Icons', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: fillPoly('208,14 286,92 108,270 14,286 30,192') },
  magnifier: {
    label: 'Magnifier', group: 'Icons', kind: 'svg', viewBox: [300, 300], ratio: 1,
    svg: parts(evenOdd(circleD(122, 122, 104) + circleD(122, 122, 72)), fillPoly('176,200 200,176 288,264 264,288')),
  },
  gear6: { label: 'Gear 6', group: 'Icons', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: evenOdd(gearD(6) + circleD(150, 150, 46)) },
  gear8: { label: 'Gear 8', group: 'Icons', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: evenOdd(gearD(8) + circleD(150, 150, 46)) },
  gear10: { label: 'Gear 10', group: 'Icons', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: evenOdd(gearD(10) + circleD(150, 150, 46)) },
  'thumbs-up': {
    label: 'Thumbs up', group: 'Icons', kind: 'svg', viewBox: [300, 300], ratio: 1,
    svg: parts(
      fillPath('M102 278 V132 C138 108 152 74 158 30 C188 26 202 52 192 102 L184 132 H252 C272 132 284 150 279 170 L256 252 C251 271 238 282 220 282 Z'),
      fillRect(30, 132, 56, 150, 14)
    ),
  },
  puzzle: { label: 'Puzzle', group: 'Icons', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: fillPath('M38 66 H108 A34 34 0 1 1 172 66 H242 V136 A34 34 0 1 0 242 200 V270 H172 A34 34 0 0 1 108 270 H38 V200 A34 34 0 0 0 38 136 Z') },
  bag: {
    label: 'Shopping bag', group: 'Icons', kind: 'svg', viewBox: [300, 300], ratio: 0.85,
    svg: (_w, _h, p) =>
      `<path d="M56 96 H244 L266 270 A16 16 0 0 1 250 288 H50 A16 16 0 0 1 34 270 Z" fill="${p.fill}"/>` +
      `<path d="M105 96 V78 A45 45 0 0 1 195 78 V96" stroke="${p.accent}" stroke-width="16" fill="none" stroke-linecap="round"/>`,
  },
  coffee: {
    label: 'Coffee', group: 'Icons', kind: 'svg', viewBox: [300, 290], ratio: 300 / 290,
    svg: (_w, _h, p) =>
      `<path d="M35 96 H225 V172 C225 234 185 268 130 268 C75 268 35 234 35 172 Z" fill="${p.fill}"/>` +
      `<path d="M225 118 C282 118 282 196 225 196" stroke="${p.accent}" stroke-width="18" fill="none" stroke-linecap="round"/>` +
      `<path d="M95 16 q-16 26 0 52 M165 16 q-16 26 0 52" stroke="${p.accent}" stroke-width="14" fill="none" stroke-linecap="round"/>`,
  },
  pause: {
    label: 'Pause', group: 'Icons', kind: 'svg', viewBox: [220, 280], ratio: 220 / 280,
    svg: parts(fillRect(28, 14, 62, 252, 18), fillRect(130, 14, 62, 252, 18)),
  },
  stop: { label: 'Stop', group: 'Icons', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: fillRect(40, 40, 220, 220, 30) },
  forward: {
    label: 'Fast forward', group: 'Icons', kind: 'svg', viewBox: [300, 240], ratio: 300 / 240,
    svg: parts(fillPoly('16,14 150,120 16,226'), fillPoly('150,14 284,120 150,226')),
  },
  rewind: {
    label: 'Rewind', group: 'Icons', kind: 'svg', viewBox: [300, 240], ratio: 300 / 240,
    svg: parts(fillPoly('284,14 150,120 284,226'), fillPoly('150,14 16,120 150,226')),
  },
  'skip-next': {
    label: 'Skip next', group: 'Icons', kind: 'svg', viewBox: [260, 240], ratio: 260 / 240,
    svg: parts(fillPoly('16,14 172,120 16,226'), fillRect(196, 14, 48, 212, 16)),
  },
  eject: {
    label: 'Eject', group: 'Icons', kind: 'svg', viewBox: [260, 240], ratio: 260 / 240,
    svg: parts(fillPoly('130,10 250,140 10,140'), fillRect(10, 172, 240, 52, 16)),
  },
  calendar: {
    label: 'Calendar', group: 'Icons', kind: 'svg', viewBox: [300, 290], ratio: 1,
    svg: parts(
      evenOdd(roundRectD(16, 46, 268, 238, 24) + roundRectD(16, 112, 268, 16)),
      fillRect(72, 12, 24, 68, 12),
      fillRect(204, 12, 24, 68, 12)
    ),
  },
  'chart-bars': {
    label: 'Bar chart', group: 'Icons', kind: 'svg', viewBox: [300, 300], ratio: 1,
    svg: parts(fillRect(34, 150, 58, 116, 8), fillRect(121, 88, 58, 178, 8), fillRect(208, 26, 58, 240, 8), fillRect(20, 278, 264, 12, 6)),
  },
  'chart-line': {
    label: 'Line chart', group: 'Icons', kind: 'svg', viewBox: [300, 300], ratio: 1, strokeBased: true,
    svg: (_w, _h, p) =>
      `<path d="M28 242 L108 148 L172 190 L272 56" stroke="${p.accent}" stroke-width="${p.strokeWidth}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<circle cx="28" cy="242" r="14" fill="${p.accent}"/><circle cx="108" cy="148" r="14" fill="${p.accent}"/>` +
      `<circle cx="172" cy="190" r="14" fill="${p.accent}"/><circle cx="272" cy="56" r="14" fill="${p.accent}"/>`,
  },
  'chart-pie': {
    label: 'Pie chart', group: 'Icons', kind: 'svg', viewBox: [300, 300], ratio: 1,
    svg: parts(
      fillPath('M150 158 L150 22 A136 136 0 1 0 277.8 111.5 Z'),
      fillPath('M168 140 L168 8 A132 132 0 0 1 292 95 Z')
    ),
  },
  thermometer: {
    label: 'Thermometer', group: 'Icons', kind: 'svg', viewBox: [160, 300], ratio: 160 / 300,
    svg: parts(
      evenOdd(roundRectD(50, 10, 60, 200, 30) + roundRectD(64, 24, 32, 180, 16)),
      fillCircle(80, 242, 52),
      fillRect(72, 130, 16, 86)
    ),
  },
  'shooting-star': {
    label: 'Shooting star', group: 'Icons', kind: 'svg', viewBox: [300, 300], ratio: 1,
    svg: (_w, _h, p) =>
      `<polygon points="${starPts(5, 0.45, 212, 88, 62)}" fill="${p.fill}"/>` +
      `<path d="M14 170 L120 118 M40 224 L146 164 M92 268 L176 216" stroke="${p.accent}" stroke-width="16" fill="none" stroke-linecap="round"/>`,
  },

  /* ---------------- Frames ---------------- */
  'frame-square': { label: 'Square frame', group: 'Frames', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: evenOdd(roundRectD(10, 10, 280, 280) + roundRectD(42, 42, 216, 216)) },
  'frame-rounded': { label: 'Rounded frame', group: 'Frames', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: evenOdd(roundRectD(10, 10, 280, 280, 42) + roundRectD(42, 42, 216, 216, 24)) },
  'frame-circle': { label: 'Circle frame', group: 'Frames', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: evenOdd(circleD(150, 150, 142) + circleD(150, 150, 112)) },
  'frame-hex': { label: 'Hex frame', group: 'Frames', kind: 'svg', viewBox: [300, 300], ratio: 1, svg: evenOdd(polyD(6, 150, 150, 145) + polyD(6, 150, 150, 112)) },
  'frame-double': {
    label: 'Double frame', group: 'Frames', kind: 'svg', viewBox: [300, 300], ratio: 1, strokeBased: true,
    svg: (_w, _h, p) =>
      `<rect x="16" y="16" width="268" height="268" stroke="${p.accent}" stroke-width="${p.strokeWidth}" fill="none"/>` +
      `<rect x="52" y="52" width="196" height="196" stroke="${p.accent}" stroke-width="${p.strokeWidth}" fill="none"/>`,
  },
  'corner-brackets': { label: 'Corner brackets', group: 'Frames', kind: 'svg', viewBox: [300, 300], ratio: 1, strokeBased: true, svg: strokePath('M20 92 V20 H92 M208 20 H280 V92 M280 208 V280 H208 M92 280 H20 V208') },
  parens: { label: 'Parentheses', group: 'Frames', kind: 'svg', viewBox: [240, 300], ratio: 240 / 300, strokeBased: true, svg: strokePath('M78 12 Q28 150 78 288 M162 12 Q212 150 162 288') },
  polaroid: { label: 'Polaroid', group: 'Frames', kind: 'svg', viewBox: [300, 300], ratio: 0.85, svg: evenOdd(roundRectD(28, 10, 244, 280, 10) + roundRectD(48, 30, 204, 192, 4)) },

  /* ---------------- Lines & Decor ---------------- */
  line: { label: 'Line', group: 'Lines & Decor', kind: 'svg', viewBox: [300, 40], ratio: 7.5, strokeBased: true, svg: strokePath('M10 20 H290') },
  'line-dashed': { label: 'Dashed line', group: 'Lines & Decor', kind: 'svg', viewBox: [300, 40], ratio: 7.5, strokeBased: true, svg: strokePath('M10 20 H290', ' stroke-dasharray="36 24"') },
  'line-dotted': { label: 'Dotted line', group: 'Lines & Decor', kind: 'svg', viewBox: [300, 40], ratio: 7.5, strokeBased: true, svg: strokePath('M10 20 H290', ' stroke-dasharray="0.1 34"') },
  'line-double': { label: 'Double line', group: 'Lines & Decor', kind: 'svg', viewBox: [300, 60], ratio: 5, strokeBased: true, svg: strokePath('M10 16 H290 M10 44 H290') },
  zigzag: { label: 'Zigzag', group: 'Lines & Decor', kind: 'svg', viewBox: [300, 60], ratio: 5, strokeBased: true, svg: strokePath('M8 46 L44 14 L80 46 L116 14 L152 46 L188 14 L224 46 L260 14 L292 42') },
  'wave-tight': { label: 'Wave line', group: 'Lines & Decor', kind: 'svg', viewBox: [300, 60], ratio: 5, strokeBased: true, svg: strokePath('M8 30 q17 -26 34 0 t34 0 t34 0 t34 0 t34 0 t34 0 t34 0 t34 0') },
  coil: {
    label: 'Coil', group: 'Lines & Decor', kind: 'svg', viewBox: [300, 90], ratio: 300 / 90, strokeBased: true,
    svg: (_w, _h, p) => {
      let d = 'M8 50 '
      for (let x = 38; x <= 278; x += 30) d += `A21 21 0 1 1 ${x} 50 `
      return `<path d="${d}" stroke="${p.accent}" stroke-width="${p.strokeWidth}" fill="none" stroke-linecap="round"/>`
    },
  },
  swash: { label: 'Swash underline', group: 'Lines & Decor', kind: 'svg', viewBox: [300, 70], ratio: 300 / 70, svg: fillPath('M8 52 C86 18 214 14 292 32 C214 34 96 40 16 62 Z') },
  'scribble-circle': { label: 'Scribble circle', group: 'Lines & Decor', kind: 'svg', viewBox: [300, 280], ratio: 300 / 280, strokeBased: true, svg: strokePath('M225 68 C118 2 22 78 44 162 C66 246 216 270 252 188 C284 112 196 44 116 70 C70 86 52 128 74 158') },
  'scribble-strike': { label: 'Scribble strike', group: 'Lines & Decor', kind: 'svg', viewBox: [300, 110], ratio: 3, strokeBased: true, svg: strokePath('M10 38 C100 16 200 16 290 30 C198 42 100 44 14 60 C104 72 202 68 288 56') },
  'brace-left': { label: 'Brace {', group: 'Lines & Decor', kind: 'svg', viewBox: [120, 300], ratio: 120 / 300, strokeBased: true, svg: strokePath('M96 10 Q58 10 58 52 Q58 138 22 150 Q58 162 58 246 Q58 290 96 290') },
  'brace-right': { label: 'Brace }', group: 'Lines & Decor', kind: 'svg', viewBox: [120, 300], ratio: 120 / 300, strokeBased: true, svg: strokePath('M24 10 Q62 10 62 52 Q62 138 98 150 Q62 162 62 246 Q62 290 24 290') },
  'divider-diamond': {
    label: 'Divider', group: 'Lines & Decor', kind: 'svg', viewBox: [300, 64], ratio: 300 / 64, strokeBased: true,
    svg: (_w, _h, p) =>
      `<path d="M8 32 H112 M188 32 H292" stroke="${p.accent}" stroke-width="${p.strokeWidth}" fill="none" stroke-linecap="round"/>` +
      `<polygon points="150,6 178,32 150,58 122,32" fill="${p.accent}"/>`,
  },
  'dots-row': {
    label: 'Dot row', group: 'Lines & Decor', kind: 'svg', viewBox: [300, 64], ratio: 300 / 64,
    svg: (_w, _h, p) => [32, 91, 150, 209, 268].map((x) => `<circle cx="${x}" cy="32" r="17" fill="${p.fill}"/>`).join(''),
  },
  'grid-squares': {
    label: 'Square grid', group: 'Lines & Decor', kind: 'svg', viewBox: [300, 300], ratio: 1,
    svg: (_w, _h, p) => {
      const out: string[] = []
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < 3; c++)
          out.push(`<rect x="${10 + c * 100}" y="${10 + r * 100}" width="80" height="80" rx="14" fill="${p.fill}"/>`)
      return out.join('')
    },
  },
  checkerboard: {
    label: 'Checkerboard', group: 'Lines & Decor', kind: 'svg', viewBox: [300, 300], ratio: 1,
    svg: (_w, _h, p) => {
      const out: string[] = []
      for (let r = 0; r < 6; r++)
        for (let c = 0; c < 6; c++)
          if ((r + c) % 2 === 0)
            out.push(`<rect x="${6 + c * 48}" y="${6 + r * 48}" width="44" height="44" rx="6" fill="${p.fill}"/>`)
      return out.join('')
    },
  },
  stripes: {
    label: 'Stripes', group: 'Lines & Decor', kind: 'svg', viewBox: [300, 300], ratio: 1,
    svg: (_w, _h, p) => {
      const out: string[] = []
      for (let k = 0; k < 7; k++)
        out.push(`<rect x="-100" y="${-90 + k * 72}" width="500" height="38" rx="19" fill="${p.fill}"/>`)
      return `<g transform="rotate(-45 150 150)">${out.join('')}</g>`
    },
  },
  halftone: {
    label: 'Halftone', group: 'Lines & Decor', kind: 'svg', viewBox: [300, 300], ratio: 1,
    svg: (_w, _h, p) => {
      const out: string[] = []
      for (let c = 0; c < 8; c++)
        for (let r = 0; r < 5; r++)
          out.push(`<circle cx="${N(20 + c * 37.2)}" cy="${30 + r * 60}" r="${N(17 - c * 1.7)}" fill="${p.fill}"/>`)
      return out.join('')
    },
  },
  'scatter-dots': {
    label: 'Dot scatter', group: 'Lines & Decor', kind: 'svg', viewBox: [300, 300], ratio: 1,
    svg: (_w, _h, p) =>
      ([[45, 60, 26], [140, 35, 15], [235, 70, 21], [60, 160, 14], [160, 130, 24], [262, 150, 12], [40, 250, 18], [135, 225, 12], [230, 240, 25], [95, 282, 10]] as const)
        .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${p.fill}"/>`)
        .join(''),
  },
  'scatter-triangles': {
    label: 'Triangle scatter', group: 'Lines & Decor', kind: 'svg', viewBox: [300, 300], ratio: 1,
    svg: (_w, _h, p) =>
      ([[50, 60, -15], [150, 40, 20], [250, 70, 45], [70, 160, 80], [170, 150, -30], [265, 160, 10], [50, 255, 25], [150, 250, -20], [250, 255, 60]] as const)
        .map(([x, y, a]) => `<polygon points="${x},${y - 22} ${x + 20},${y + 14} ${x - 20},${y + 14}" fill="${p.fill}" transform="rotate(${a} ${x} ${y})"/>`)
        .join(''),
  },
  'plus-grid': {
    label: 'Plus pattern', group: 'Lines & Decor', kind: 'svg', viewBox: [300, 280], ratio: 300 / 280,
    svg: (_w, _h, p) => {
      const out: string[] = []
      for (const y of [80, 200])
        for (const x of [60, 150, 240]) {
          out.push(`<rect x="${x - 7}" y="${y - 28}" width="14" height="56" rx="7" fill="${p.fill}"/>`)
          out.push(`<rect x="${x - 28}" y="${y - 7}" width="56" height="14" rx="7" fill="${p.fill}"/>`)
        }
      return out.join('')
    },
  },
  starfield: {
    label: 'Starfield', group: 'Lines & Decor', kind: 'svg', viewBox: [300, 300], ratio: 1,
    svg: (_w, _h, p) =>
      ([[60, 70, 1.6], [170, 40, 1], [250, 90, 1.3], [90, 170, 0.9], [200, 160, 1.7], [48, 255, 1.1], [150, 250, 0.8], [255, 230, 1.4]] as const)
        .map(
          ([x, y, s]) =>
            `<path d="M0 -16 L4 -4 L16 0 L4 4 L0 16 L-4 4 L-16 0 L-4 -4 Z" fill="${p.fill}" transform="translate(${x} ${y}) scale(${s})"/>`
        )
        .join(''),
  },
}

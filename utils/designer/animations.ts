/**
 * Animation preset library for the Design Studio.
 *
 * Every preset is a pure CSS generator: keyframes + a rule binding them to
 * the layer's animation target. The compiler drives them deterministically —
 * the same CSS animates live on the stage (Shadow DOM) and is captured
 * frame-by-frame by the package's headless browser via the Web Animations
 * API, so what you see is exactly what renders.
 *
 * Split-text presets rely on each letter/word span carrying `--i` (its
 * index): entrances stagger with positive delays, loops phase with negative
 * delays so the wave is already rolling at t=0.
 */

export interface AnimCtx {
  /** selector of the animated element(s): `.dz-lN .dz-a` or `.dz-lN .dz-c` */
  sel: string
  /** layer wrapper selector (for perspective / pseudo-element extras) */
  layerSel: string
  /** unique keyframes-name prefix for this layer */
  kf: string
  dur: number
  delay: number
  stagger: number
  /** number of split units (letters/words); 1 when not split */
  count: number
  ease: string
  dir: 'up' | 'down' | 'left' | 'right'
  /** when the last staggered entrance finishes (for follow-up effects) */
  entranceEnd: number
  /** layer accent colors (gradient stops or solid color) for glow/sweep presets */
  colors: { from: string; to: string }
}

export interface AnimPresetDef {
  id: string
  label: string
  hint: string
  group: 'Text entrance' | 'Text loop' | 'Entrance' | 'Loop'
  /** text-only presets that split content into spans */
  split?: 'letter' | 'word'
  /** loops repeat forever; entrances play once and hold */
  infinite?: boolean
  textOnly?: boolean
  hasDirection?: boolean
  hasEasing?: boolean
  defaults: { duration: number; stagger?: number }
  css: (c: AnimCtx) => string
}

export const EASINGS: Record<string, { label: string; value: string }> = {
  smooth: { label: 'Smooth', value: 'cubic-bezier(0.16, 1, 0.3, 1)' },
  overshoot: { label: 'Overshoot', value: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
  'ease-out': { label: 'Ease out', value: 'ease-out' },
  'ease-in-out': { label: 'Ease in-out', value: 'ease-in-out' },
  linear: { label: 'Linear', value: 'linear' },
}

export function easingValue(id: string): string {
  return EASINGS[id]?.value ?? EASINGS.smooth.value
}

const staggerDelay = (c: AnimCtx) =>
  c.count > 1 ? `calc(${c.delay}s + var(--i) * ${c.stagger}s)` : `${c.delay}s`

/** negative phase so infinite split loops are mid-flight at t=0 */
const phaseDelay = (c: AnimCtx) => `calc(var(--i) * -${c.stagger}s)`

const DIR_OFFSET: Record<AnimCtx['dir'], [string, string]> = {
  up: ['0', '46px'],
  down: ['0', '-46px'],
  left: ['46px', '0'],
  right: ['-46px', '0'],
}

/** numeric offsets for presets that scale the slide distance per keyframe */
const SLIDE_NUM: Record<AnimCtx['dir'], [number, number]> = {
  up: [0, 90],
  down: [0, -90],
  left: [90, 0],
  right: [-90, 0],
}

const round1 = (v: number) => Math.round(v * 10) / 10

export const ANIM_PRESETS: Record<string, AnimPresetDef> = {
  /* ================= TEXT ENTRANCES (split) ================= */

  typewriter: {
    id: 'typewriter',
    label: 'Typewriter',
    hint: 'letters appear one by one with a blinking caret',
    group: 'Text entrance',
    split: 'letter',
    textOnly: true,
    defaults: { duration: 0.01, stagger: 0.08 },
    css: (c) => `
${c.sel} { opacity: 0; animation: ${c.kf}-in 0.01s steps(1, end) both; animation-delay: ${staggerDelay(c)}; }
@keyframes ${c.kf}-in { to { opacity: 1; } }
${c.layerSel} .dz-a::after { content: ''; display: inline-block; width: 0.07em; height: 0.95em; margin-left: 0.06em; vertical-align: -0.12em; background: ${c.colors.from}; animation: ${c.kf}-blink 0.9s steps(1, end) infinite, ${c.kf}-off 0.01s linear ${(c.entranceEnd + 1.4).toFixed(2)}s both; }
@keyframes ${c.kf}-blink { 50% { opacity: 0; } }
@keyframes ${c.kf}-off { to { opacity: 0; width: 0; margin-left: 0; } }`,
  },

  'letter-pop': {
    id: 'letter-pop',
    label: 'Letter pop',
    hint: 'letters scale in with a bouncy overshoot',
    group: 'Text entrance',
    split: 'letter',
    textOnly: true,
    hasEasing: true,
    defaults: { duration: 0.45, stagger: 0.055 },
    css: (c) => `
${c.sel} { opacity: 0; animation: ${c.kf} ${c.dur}s ${c.ease} both; animation-delay: ${staggerDelay(c)}; }
@keyframes ${c.kf} { from { opacity: 0; transform: scale(0.2); } 70% { opacity: 1; transform: scale(1.14); } to { opacity: 1; transform: scale(1); } }`,
  },

  rise: {
    id: 'rise',
    label: 'Rise',
    hint: 'letters float up into place',
    group: 'Text entrance',
    split: 'letter',
    textOnly: true,
    hasEasing: true,
    defaults: { duration: 0.55, stagger: 0.04 },
    css: (c) => `
${c.sel} { opacity: 0; animation: ${c.kf} ${c.dur}s ${c.ease} both; animation-delay: ${staggerDelay(c)}; }
@keyframes ${c.kf} { from { opacity: 0; transform: translateY(0.65em); } to { opacity: 1; transform: translateY(0); } }`,
  },

  'drop-spin': {
    id: 'drop-spin',
    label: 'Drop & spin',
    hint: 'letters tumble down from above',
    group: 'Text entrance',
    split: 'letter',
    textOnly: true,
    hasEasing: true,
    defaults: { duration: 0.6, stagger: 0.06 },
    css: (c) => `
${c.sel} { opacity: 0; animation: ${c.kf} ${c.dur}s ${c.ease} both; animation-delay: ${staggerDelay(c)}; }
@keyframes ${c.kf} { from { opacity: 0; transform: translateY(-1.1em) rotate(-14deg) scale(1.15); } to { opacity: 1; transform: translateY(0) rotate(0) scale(1); } }`,
  },

  'flip-in': {
    id: 'flip-in',
    label: 'Flip in',
    hint: 'letters flip up like a departures board',
    group: 'Text entrance',
    split: 'letter',
    textOnly: true,
    defaults: { duration: 0.5, stagger: 0.05 },
    css: (c) => `
${c.layerSel} .dz-a { perspective: 420px; }
${c.sel} { opacity: 0; transform-origin: 50% 100%; animation: ${c.kf} ${c.dur}s cubic-bezier(0.16, 1, 0.3, 1) both; animation-delay: ${staggerDelay(c)}; }
@keyframes ${c.kf} { from { opacity: 0; transform: rotateX(-92deg); } to { opacity: 1; transform: rotateX(0); } }`,
  },

  'blur-in': {
    id: 'blur-in',
    label: 'Blur reveal',
    hint: 'letters sharpen out of a blur',
    group: 'Text entrance',
    split: 'letter',
    textOnly: true,
    defaults: { duration: 0.7, stagger: 0.045 },
    css: (c) => `
${c.sel} { opacity: 0; animation: ${c.kf} ${c.dur}s ease-out both; animation-delay: ${staggerDelay(c)}; }
@keyframes ${c.kf} { from { opacity: 0; filter: blur(10px); transform: scale(1.25); } to { opacity: 1; filter: blur(0); transform: scale(1); } }`,
  },

  'word-rise': {
    id: 'word-rise',
    label: 'Word by word',
    hint: 'words fade up one after another',
    group: 'Text entrance',
    split: 'word',
    textOnly: true,
    hasEasing: true,
    defaults: { duration: 0.5, stagger: 0.16 },
    css: (c) => `
${c.sel} { opacity: 0; animation: ${c.kf} ${c.dur}s ${c.ease} both; animation-delay: ${staggerDelay(c)}; }
@keyframes ${c.kf} { from { opacity: 0; transform: translateY(0.5em); } to { opacity: 1; transform: translateY(0); } }`,
  },

  'word-slide': {
    id: 'word-slide',
    label: 'Word slide',
    hint: 'words swing in from the side',
    group: 'Text entrance',
    split: 'word',
    textOnly: true,
    hasEasing: true,
    defaults: { duration: 0.55, stagger: 0.14 },
    css: (c) => `
${c.sel} { opacity: 0; animation: ${c.kf} ${c.dur}s ${c.ease} both; animation-delay: ${staggerDelay(c)}; }
@keyframes ${c.kf} { from { opacity: 0; transform: translateX(-0.9em) skewX(8deg); } to { opacity: 1; transform: translateX(0) skewX(0); } }`,
  },

  'tracking-in': {
    id: 'tracking-in',
    label: 'Tracking in',
    hint: 'letter spacing contracts into place',
    group: 'Text entrance',
    textOnly: true,
    defaults: { duration: 0.9 },
    css: (c) => `
${c.sel} { animation: ${c.kf} ${c.dur}s cubic-bezier(0.16, 1, 0.3, 1) ${c.delay}s both; }
@keyframes ${c.kf} { from { opacity: 0; letter-spacing: 0.5em; filter: blur(3px); } to { opacity: 1; letter-spacing: inherit; filter: blur(0); } }`,
  },

  'letter-slide': {
    id: 'letter-slide',
    label: 'Letter slide',
    hint: 'letters glide in sideways with a skew',
    group: 'Text entrance',
    split: 'letter',
    textOnly: true,
    hasEasing: true,
    defaults: { duration: 0.5, stagger: 0.045 },
    css: (c) => `
${c.sel} { opacity: 0; animation: ${c.kf} ${c.dur}s ${c.ease} both; animation-delay: ${staggerDelay(c)}; }
@keyframes ${c.kf} { from { opacity: 0; transform: translateX(-0.7em) skewX(-14deg); } to { opacity: 1; transform: translateX(0) skewX(0); } }`,
  },

  'letter-roll': {
    id: 'letter-roll',
    label: 'Letter roll',
    hint: 'letters roll in spinning like wheels',
    group: 'Text entrance',
    split: 'letter',
    textOnly: true,
    hasEasing: true,
    defaults: { duration: 0.6, stagger: 0.055 },
    css: (c) => `
${c.sel} { opacity: 0; animation: ${c.kf} ${c.dur}s ${c.ease} both; animation-delay: ${staggerDelay(c)}; }
@keyframes ${c.kf} { from { opacity: 0; transform: translateX(-1.1em) rotate(-150deg) scale(0.7); } to { opacity: 1; transform: translateX(0) rotate(0) scale(1); } }`,
  },

  'flip-down': {
    id: 'flip-down',
    label: 'Flip down',
    hint: 'letters hinge down from above',
    group: 'Text entrance',
    split: 'letter',
    textOnly: true,
    defaults: { duration: 0.55, stagger: 0.05 },
    css: (c) => `
${c.layerSel} .dz-a { perspective: 460px; }
${c.sel} { opacity: 0; transform-origin: 50% 0%; animation: ${c.kf} ${c.dur}s cubic-bezier(0.16, 1, 0.3, 1) both; animation-delay: ${staggerDelay(c)}; }
@keyframes ${c.kf} { from { opacity: 0; transform: rotateX(92deg); } to { opacity: 1; transform: rotateX(0); } }`,
  },

  'fall-bounce': {
    id: 'fall-bounce',
    label: 'Fall & bounce',
    hint: 'letters drop in and bounce on landing',
    group: 'Text entrance',
    split: 'letter',
    textOnly: true,
    defaults: { duration: 0.7, stagger: 0.06 },
    css: (c) => `
${c.sel} { opacity: 0; animation: ${c.kf} ${c.dur}s linear both; animation-delay: ${staggerDelay(c)}; }
@keyframes ${c.kf} { 0% { opacity: 0; transform: translateY(-1.4em); } 45% { opacity: 1; transform: translateY(0); } 62% { transform: translateY(-0.24em); } 78% { transform: translateY(0); } 89% { transform: translateY(-0.08em); } 100% { opacity: 1; transform: translateY(0); } }`,
  },

  'stretch-in': {
    id: 'stretch-in',
    label: 'Stretch in',
    hint: 'letters stretch open from a sliver',
    group: 'Text entrance',
    split: 'letter',
    textOnly: true,
    defaults: { duration: 0.5, stagger: 0.05 },
    css: (c) => `
${c.sel} { opacity: 0; animation: ${c.kf} ${c.dur}s cubic-bezier(0.16, 1, 0.3, 1) both; animation-delay: ${staggerDelay(c)}; }
@keyframes ${c.kf} { 0% { opacity: 0; transform: scale(0.1, 1.4); } 60% { opacity: 1; transform: scale(1.25, 0.95); } 100% { opacity: 1; transform: scale(1, 1); } }`,
  },

  'whirl-in': {
    id: 'whirl-in',
    label: 'Whirl in',
    hint: 'letters whirl around their axis into place',
    group: 'Text entrance',
    split: 'letter',
    textOnly: true,
    defaults: { duration: 0.65, stagger: 0.05 },
    css: (c) => `
${c.layerSel} .dz-a { perspective: 500px; }
${c.sel} { opacity: 0; animation: ${c.kf} ${c.dur}s cubic-bezier(0.16, 1, 0.3, 1) both; animation-delay: ${staggerDelay(c)}; }
@keyframes ${c.kf} { from { opacity: 0; transform: rotateY(-190deg) scale(0.5); } to { opacity: 1; transform: rotateY(0) scale(1); } }`,
  },

  'mask-rise': {
    id: 'mask-rise',
    label: 'Mask rise',
    hint: 'letters rise out of an invisible mask',
    group: 'Text entrance',
    split: 'letter',
    textOnly: true,
    hasEasing: true,
    defaults: { duration: 0.6, stagger: 0.04 },
    css: (c) => `
${c.layerSel} .dz-a { overflow: hidden; }
${c.sel} { animation: ${c.kf} ${c.dur}s ${c.ease} both; animation-delay: ${staggerDelay(c)}; }
@keyframes ${c.kf} { from { transform: translateY(118%); } to { transform: translateY(0); } }`,
  },

  'elastic-pop': {
    id: 'elastic-pop',
    label: 'Elastic pop',
    hint: 'letters spring in with an elastic wobble',
    group: 'Text entrance',
    split: 'letter',
    textOnly: true,
    defaults: { duration: 0.8, stagger: 0.06 },
    css: (c) => `
${c.sel} { opacity: 0; animation: ${c.kf} ${c.dur}s linear both; animation-delay: ${staggerDelay(c)}; }
@keyframes ${c.kf} { 0% { opacity: 0; transform: scale(0); } 45% { opacity: 1; transform: scale(1.28); } 62% { transform: scale(0.88); } 76% { transform: scale(1.08); } 88% { transform: scale(0.97); } 100% { opacity: 1; transform: scale(1); } }`,
  },

  'seesaw-in': {
    id: 'seesaw-in',
    label: 'Seesaw in',
    hint: 'letters tilt in from alternating sides',
    group: 'Text entrance',
    split: 'letter',
    textOnly: true,
    hasEasing: true,
    defaults: { duration: 0.55, stagger: 0.05 },
    css: (c) => `
${c.sel} { opacity: 0; animation: ${c.kf}-a ${c.dur}s ${c.ease} both; animation-delay: ${staggerDelay(c)}; }
${c.sel}:nth-child(even) { animation-name: ${c.kf}-b; }
@keyframes ${c.kf}-a { from { opacity: 0; transform: rotate(-26deg) translateY(0.55em); } to { opacity: 1; transform: rotate(0) translateY(0); } }
@keyframes ${c.kf}-b { from { opacity: 0; transform: rotate(26deg) translateY(0.55em); } to { opacity: 1; transform: rotate(0) translateY(0); } }`,
  },

  'word-pop': {
    id: 'word-pop',
    label: 'Word pop',
    hint: 'words pop in with a bounce',
    group: 'Text entrance',
    split: 'word',
    textOnly: true,
    defaults: { duration: 0.5, stagger: 0.18 },
    css: (c) => `
${c.sel} { opacity: 0; animation: ${c.kf} ${c.dur}s cubic-bezier(0.34, 1.56, 0.64, 1) both; animation-delay: ${staggerDelay(c)}; }
@keyframes ${c.kf} { from { opacity: 0; transform: scale(0.4); } to { opacity: 1; transform: scale(1); } }`,
  },

  'word-flip': {
    id: 'word-flip',
    label: 'Word flip',
    hint: 'words flip up like cards',
    group: 'Text entrance',
    split: 'word',
    textOnly: true,
    defaults: { duration: 0.6, stagger: 0.16 },
    css: (c) => `
${c.layerSel} .dz-a { perspective: 520px; }
${c.sel} { opacity: 0; transform-origin: 50% 100%; animation: ${c.kf} ${c.dur}s cubic-bezier(0.16, 1, 0.3, 1) both; animation-delay: ${staggerDelay(c)}; }
@keyframes ${c.kf} { from { opacity: 0; transform: rotateX(-95deg); } to { opacity: 1; transform: rotateX(0); } }`,
  },

  'typewriter-words': {
    id: 'typewriter-words',
    label: 'Typewriter words',
    hint: 'words appear one at a time, no caret',
    group: 'Text entrance',
    split: 'word',
    textOnly: true,
    defaults: { duration: 0.01, stagger: 0.24 },
    css: (c) => `
${c.sel} { opacity: 0; animation: ${c.kf} 0.01s steps(1, end) both; animation-delay: ${staggerDelay(c)}; }
@keyframes ${c.kf} { to { opacity: 1; } }`,
  },

  /* ================= TEXT LOOPS ================= */

  wave: {
    id: 'wave',
    label: 'Wave',
    hint: 'letters bob in a rolling wave',
    group: 'Text loop',
    split: 'letter',
    textOnly: true,
    infinite: true,
    defaults: { duration: 1.2, stagger: 0.09 },
    css: (c) => `
${c.sel} { animation: ${c.kf} ${c.dur}s ease-in-out ${phaseDelay(c)} infinite; }
@keyframes ${c.kf} { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-0.32em); } }`,
  },

  jelly: {
    id: 'jelly',
    label: 'Jelly',
    hint: 'letters squash and stretch in turn',
    group: 'Text loop',
    split: 'letter',
    textOnly: true,
    infinite: true,
    defaults: { duration: 1.6, stagger: 0.07 },
    css: (c) => `
${c.sel} { transform-origin: 50% 100%; animation: ${c.kf} ${c.dur}s ease-in-out ${phaseDelay(c)} infinite; }
@keyframes ${c.kf} { 0%, 30%, 100% { transform: scale(1, 1); } 10% { transform: scale(1.15, 0.82); } 20% { transform: scale(0.92, 1.12); } }`,
  },

  'gradient-sweep': {
    id: 'gradient-sweep',
    label: 'Gradient sweep',
    hint: 'a gradient glides across the text forever',
    group: 'Text loop',
    textOnly: true,
    infinite: true,
    defaults: { duration: 2.4 },
    css: (c) => `
${c.sel} { background-image: linear-gradient(100deg, ${c.colors.from}, ${c.colors.to}, ${c.colors.from}); background-size: 220% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; -webkit-text-fill-color: transparent; animation: ${c.kf} ${c.dur}s linear infinite; }
@keyframes ${c.kf} { to { background-position: -220% 0; } }`,
  },

  neon: {
    id: 'neon',
    label: 'Neon flicker',
    hint: 'buzzing neon-sign glow',
    group: 'Text loop',
    textOnly: true,
    infinite: true,
    defaults: { duration: 3 },
    css: (c) => `
${c.sel} { animation: ${c.kf} ${c.dur}s linear infinite; }
@keyframes ${c.kf} {
  0%, 18.9%, 21.1%, 61.9%, 63.1%, 100% { opacity: 1; text-shadow: 0 0 7px ${c.colors.from}, 0 0 22px ${c.colors.from}, 0 0 46px ${c.colors.to}; }
  19%, 21% { opacity: 0.45; text-shadow: none; }
  62%, 63% { opacity: 0.6; text-shadow: 0 0 6px ${c.colors.from}; }
}`,
  },

  glitch: {
    id: 'glitch',
    label: 'Glitch',
    hint: 'jittery RGB-split distortion',
    group: 'Text loop',
    textOnly: true,
    infinite: true,
    defaults: { duration: 1.8 },
    css: (c) => `
${c.sel} { animation: ${c.kf} ${c.dur}s steps(1, end) infinite; }
@keyframes ${c.kf} {
  0%, 6.5%, 9%, 42%, 46.5%, 76%, 79.5%, 100% { transform: translate(0, 0) skewX(0); text-shadow: none; }
  7% { transform: translate(-3px, 2px) skewX(-8deg); text-shadow: 3px 0 0 rgba(255, 0, 60, 0.85), -3px 0 0 rgba(0, 220, 255, 0.85); }
  8% { transform: translate(3px, -1px) skewX(6deg); text-shadow: -3px 0 0 rgba(255, 0, 60, 0.85), 3px 0 0 rgba(0, 220, 255, 0.85); }
  43% { transform: translate(2px, 1px); text-shadow: 2px 0 0 rgba(255, 0, 60, 0.85), -2px 0 0 rgba(0, 220, 255, 0.85); }
  45% { transform: translate(-2px, -2px) skewX(4deg); text-shadow: -4px 0 0 rgba(255, 0, 60, 0.7), 4px 0 0 rgba(0, 220, 255, 0.7); }
  77% { transform: translate(-1px, 2px); text-shadow: 2px 0 0 rgba(255, 0, 60, 0.85), -2px 0 0 rgba(0, 220, 255, 0.85); }
}`,
  },

  rainbow: {
    id: 'rainbow',
    label: 'Rainbow',
    hint: 'colors cycle around the hue wheel',
    group: 'Text loop',
    textOnly: true,
    infinite: true,
    defaults: { duration: 3 },
    css: (c) => `
${c.sel} { animation: ${c.kf} ${c.dur}s linear infinite; }
@keyframes ${c.kf} { from { filter: hue-rotate(0deg); } to { filter: hue-rotate(360deg); } }`,
  },

  shake: {
    id: 'shake',
    label: 'Shake',
    hint: 'nervous rapid shaking',
    group: 'Text loop',
    textOnly: true,
    infinite: true,
    defaults: { duration: 0.5 },
    css: (c) => `
${c.sel} { animation: ${c.kf} ${c.dur}s linear infinite; }
@keyframes ${c.kf} { 0%, 100% { transform: translate(0, 0); } 20% { transform: translate(-2px, 1px) rotate(-0.6deg); } 40% { transform: translate(2px, -1px) rotate(0.6deg); } 60% { transform: translate(-2px, -1px); } 80% { transform: translate(2px, 1px); } }`,
  },

  'bounce-loop': {
    id: 'bounce-loop',
    label: 'Bounce loop',
    hint: 'letters bounce in a rolling sequence',
    group: 'Text loop',
    split: 'letter',
    textOnly: true,
    infinite: true,
    defaults: { duration: 1.4, stagger: 0.08 },
    css: (c) => `
${c.sel} { animation: ${c.kf} ${c.dur}s cubic-bezier(0.36, 0, 0.64, 1) ${phaseDelay(c)} infinite; }
@keyframes ${c.kf} { 0%, 50%, 100% { transform: translateY(0); } 22% { transform: translateY(-0.4em); } 38% { transform: translateY(0.05em); } }`,
  },

  'color-cycle': {
    id: 'color-cycle',
    label: 'Color cycle',
    hint: 'a rainbow rolls letter by letter',
    group: 'Text loop',
    split: 'letter',
    textOnly: true,
    infinite: true,
    defaults: { duration: 2.4, stagger: 0.12 },
    css: (c) => `
${c.sel} { animation: ${c.kf} ${c.dur}s linear ${phaseDelay(c)} infinite; }
@keyframes ${c.kf} { from { filter: hue-rotate(0deg); } to { filter: hue-rotate(360deg); } }`,
  },

  shimmer: {
    id: 'shimmer',
    label: 'Shimmer',
    hint: 'a light streak sweeps across the text',
    group: 'Text loop',
    textOnly: true,
    infinite: true,
    defaults: { duration: 2.2 },
    css: (c) => `
${c.sel} { background-image: linear-gradient(105deg, ${c.colors.from} 40%, #ffffff 50%, ${c.colors.from} 60%); background-size: 240% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; -webkit-text-fill-color: transparent; animation: ${c.kf} ${c.dur}s linear infinite; }
@keyframes ${c.kf} { from { background-position: 120% 0; } to { background-position: -120% 0; } }`,
  },

  'pulse-glow': {
    id: 'pulse-glow',
    label: 'Pulse glow',
    hint: 'a soft glow breathes around the text',
    group: 'Text loop',
    textOnly: true,
    infinite: true,
    defaults: { duration: 1.8 },
    css: (c) => `
${c.sel} { animation: ${c.kf} ${c.dur}s ease-in-out infinite; }
@keyframes ${c.kf} { 0%, 100% { text-shadow: 0 0 6px ${c.colors.from}; } 50% { text-shadow: 0 0 18px ${c.colors.from}, 0 0 46px ${c.colors.to}; } }`,
  },

  'wobble-text': {
    id: 'wobble-text',
    label: 'Wobble',
    hint: 'letters rock side to side in a wave',
    group: 'Text loop',
    split: 'letter',
    textOnly: true,
    infinite: true,
    defaults: { duration: 1.3, stagger: 0.08 },
    css: (c) => `
${c.sel} { animation: ${c.kf} ${c.dur}s ease-in-out ${phaseDelay(c)} infinite; }
@keyframes ${c.kf} { 0%, 100% { transform: rotate(-8deg) translateY(0.03em); } 50% { transform: rotate(8deg) translateY(-0.03em); } }`,
  },

  'float-drift': {
    id: 'float-drift',
    label: 'Float drift',
    hint: 'alternating letters drift up and down',
    group: 'Text loop',
    split: 'letter',
    textOnly: true,
    infinite: true,
    defaults: { duration: 2, stagger: 0.06 },
    css: (c) => `
${c.sel} { animation: ${c.kf} ${c.dur}s ease-in-out ${phaseDelay(c)} infinite; }
${c.sel}:nth-child(even) { animation-delay: calc(var(--i) * -${c.stagger}s - ${(c.dur / 2).toFixed(2)}s); }
@keyframes ${c.kf} { 0%, 100% { transform: translateY(-0.14em); } 50% { transform: translateY(0.14em); } }`,
  },

  'blink-caret': {
    id: 'blink-caret',
    label: 'Blinking caret',
    hint: 'a terminal-style caret blinks after the text',
    group: 'Text loop',
    textOnly: true,
    infinite: true,
    defaults: { duration: 1 },
    css: (c) => `
${c.layerSel} .dz-a::after { content: ''; display: inline-block; width: 0.08em; height: 0.95em; margin-left: 0.08em; vertical-align: -0.12em; background: ${c.colors.from}; animation: ${c.kf} ${c.dur}s steps(1, end) infinite; }
@keyframes ${c.kf} { 50% { opacity: 0; } }`,
  },

  flicker: {
    id: 'flicker',
    label: 'Flicker',
    hint: 'subtle unstable brightness, like a bad bulb',
    group: 'Text loop',
    textOnly: true,
    infinite: true,
    defaults: { duration: 2.6 },
    css: (c) => `
${c.sel} { animation: ${c.kf} ${c.dur}s steps(1, end) infinite; }
@keyframes ${c.kf} { 0%, 8.9%, 10.1%, 33.9%, 35.6%, 66.9%, 68.1%, 100% { opacity: 1; } 9%, 10% { opacity: 0.72; } 34%, 35.5% { opacity: 0.8; } 67%, 68% { opacity: 0.65; } }`,
  },

  /* ================= GENERIC ENTRANCES ================= */

  'fade-in': {
    id: 'fade-in',
    label: 'Fade in',
    hint: 'simple opacity fade',
    group: 'Entrance',
    hasEasing: true,
    defaults: { duration: 0.6 },
    css: (c) => `
${c.sel} { opacity: 0; animation: ${c.kf} ${c.dur}s ${c.ease} ${c.delay}s both; }
@keyframes ${c.kf} { from { opacity: 0; } to { opacity: 1; } }`,
  },

  'slide-in': {
    id: 'slide-in',
    label: 'Slide in',
    hint: 'glides in from a direction',
    group: 'Entrance',
    hasDirection: true,
    hasEasing: true,
    defaults: { duration: 0.6 },
    css: (c) => {
      const [x, y] = DIR_OFFSET[c.dir]
      return `
${c.sel} { opacity: 0; animation: ${c.kf} ${c.dur}s ${c.ease} ${c.delay}s both; }
@keyframes ${c.kf} { from { opacity: 0; transform: translate(${x}, ${y}); } to { opacity: 1; transform: translate(0, 0); } }`
    },
  },

  'zoom-in': {
    id: 'zoom-in',
    label: 'Zoom in',
    hint: 'scales up from nothing',
    group: 'Entrance',
    hasEasing: true,
    defaults: { duration: 0.55 },
    css: (c) => `
${c.sel} { opacity: 0; animation: ${c.kf} ${c.dur}s ${c.ease} ${c.delay}s both; }
@keyframes ${c.kf} { from { opacity: 0; transform: scale(0.25); } to { opacity: 1; transform: scale(1); } }`,
  },

  'bounce-in': {
    id: 'bounce-in',
    label: 'Bounce in',
    hint: 'lands with a springy bounce',
    group: 'Entrance',
    defaults: { duration: 0.75 },
    css: (c) => `
${c.sel} { opacity: 0; animation: ${c.kf} ${c.dur}s cubic-bezier(0.22, 1, 0.36, 1) ${c.delay}s both; }
@keyframes ${c.kf} { 0% { opacity: 0; transform: scale(0.3); } 45% { opacity: 1; transform: scale(1.12); } 70% { transform: scale(0.94); } 100% { opacity: 1; transform: scale(1); } }`,
  },

  'spin-in': {
    id: 'spin-in',
    label: 'Spin in',
    hint: 'twirls into place',
    group: 'Entrance',
    hasEasing: true,
    defaults: { duration: 0.7 },
    css: (c) => `
${c.sel} { opacity: 0; animation: ${c.kf} ${c.dur}s ${c.ease} ${c.delay}s both; }
@keyframes ${c.kf} { from { opacity: 0; transform: rotate(-200deg) scale(0.3); } to { opacity: 1; transform: rotate(0) scale(1); } }`,
  },

  'wipe-in': {
    id: 'wipe-in',
    label: 'Wipe in',
    hint: 'revealed by a clean directional wipe',
    group: 'Entrance',
    hasDirection: true,
    defaults: { duration: 0.7 },
    css: (c) => {
      const from =
        c.dir === 'up'
          ? 'inset(100% 0 0 0)'
          : c.dir === 'down'
            ? 'inset(0 0 100% 0)'
            : c.dir === 'left'
              ? 'inset(0 0 0 100%)'
              : 'inset(0 100% 0 0)'
      return `
${c.sel} { animation: ${c.kf} ${c.dur}s cubic-bezier(0.16, 1, 0.3, 1) ${c.delay}s both; }
@keyframes ${c.kf} { from { clip-path: ${from}; } to { clip-path: inset(0 0 0 0); } }`
    },
  },

  pop: {
    id: 'pop',
    label: 'Pop',
    hint: 'quick snappy scale-up',
    group: 'Entrance',
    defaults: { duration: 0.35 },
    css: (c) => `
${c.sel} { opacity: 0; animation: ${c.kf} ${c.dur}s cubic-bezier(0.22, 1, 0.36, 1) ${c.delay}s both; }
@keyframes ${c.kf} { 0% { opacity: 0; transform: scale(0.5); } 65% { opacity: 1; transform: scale(1.08); } 100% { opacity: 1; transform: scale(1); } }`,
  },

  'drop-bounce': {
    id: 'drop-bounce',
    label: 'Drop & bounce',
    hint: 'falls from above and bounces to rest',
    group: 'Entrance',
    defaults: { duration: 0.9 },
    css: (c) => `
${c.sel} { opacity: 0; animation: ${c.kf} ${c.dur}s linear ${c.delay}s both; }
@keyframes ${c.kf} { 0% { opacity: 0; transform: translateY(-110px); } 40% { opacity: 1; transform: translateY(0); } 58% { transform: translateY(-34px); } 74% { transform: translateY(0); } 86% { transform: translateY(-12px); } 100% { opacity: 1; transform: translateY(0); } }`,
  },

  'flip-3d': {
    id: 'flip-3d',
    label: '3D flip',
    hint: 'flips in around a 3D axis',
    group: 'Entrance',
    hasDirection: true,
    hasEasing: true,
    defaults: { duration: 0.7 },
    css: (c) => {
      const axis = c.dir === 'up' || c.dir === 'down' ? 'rotateX' : 'rotateY'
      const sign = c.dir === 'up' || c.dir === 'right' ? 1 : -1
      return `
${c.layerSel} { perspective: 800px; }
${c.sel} { opacity: 0; animation: ${c.kf} ${c.dur}s ${c.ease} ${c.delay}s both; }
@keyframes ${c.kf} { from { opacity: 0; transform: ${axis}(${sign * 95}deg); } to { opacity: 1; transform: ${axis}(0); } }`
    },
  },

  'roll-in': {
    id: 'roll-in',
    label: 'Roll in',
    hint: 'rolls in from the side like a wheel',
    group: 'Entrance',
    hasEasing: true,
    defaults: { duration: 0.7 },
    css: (c) => `
${c.sel} { opacity: 0; animation: ${c.kf} ${c.dur}s ${c.ease} ${c.delay}s both; }
@keyframes ${c.kf} { from { opacity: 0; transform: translateX(-110px) rotate(-220deg) scale(0.6); } to { opacity: 1; transform: translateX(0) rotate(0) scale(1); } }`,
  },

  'blur-zoom': {
    id: 'blur-zoom',
    label: 'Blur zoom',
    hint: 'sharpens out of a blurry close-up',
    group: 'Entrance',
    defaults: { duration: 0.8 },
    css: (c) => `
${c.sel} { opacity: 0; animation: ${c.kf} ${c.dur}s ease-out ${c.delay}s both; }
@keyframes ${c.kf} { from { opacity: 0; filter: blur(16px); transform: scale(1.7); } to { opacity: 1; filter: blur(0); transform: scale(1); } }`,
  },

  'iris-in': {
    id: 'iris-in',
    label: 'Iris reveal',
    hint: 'revealed through an expanding circle',
    group: 'Entrance',
    defaults: { duration: 0.8 },
    css: (c) => `
${c.sel} { animation: ${c.kf} ${c.dur}s cubic-bezier(0.16, 1, 0.3, 1) ${c.delay}s both; }
@keyframes ${c.kf} { from { clip-path: circle(0% at 50% 50%); } to { clip-path: circle(125% at 50% 50%); } }`,
  },

  'curtain-reveal': {
    id: 'curtain-reveal',
    label: 'Curtain reveal',
    hint: 'opens outward from the center line',
    group: 'Entrance',
    hasDirection: true,
    defaults: { duration: 0.7 },
    css: (c) => {
      const from = c.dir === 'up' || c.dir === 'down' ? 'inset(50% 0 50% 0)' : 'inset(0 50% 0 50%)'
      return `
${c.sel} { animation: ${c.kf} ${c.dur}s cubic-bezier(0.16, 1, 0.3, 1) ${c.delay}s both; }
@keyframes ${c.kf} { from { clip-path: ${from}; } to { clip-path: inset(0 0 0 0); } }`
    },
  },

  unfold: {
    id: 'unfold',
    label: 'Unfold',
    hint: 'folds down from its top edge',
    group: 'Entrance',
    hasEasing: true,
    defaults: { duration: 0.75 },
    css: (c) => `
${c.layerSel} { perspective: 700px; }
${c.sel} { opacity: 0; transform-origin: 50% 0%; animation: ${c.kf} ${c.dur}s ${c.ease} ${c.delay}s both; }
@keyframes ${c.kf} { 0% { opacity: 0; transform: rotateX(-88deg); } 30% { opacity: 1; } 100% { opacity: 1; transform: rotateX(0); } }`,
  },

  'swing-in': {
    id: 'swing-in',
    label: 'Swing in',
    hint: 'swings from a hinge and settles',
    group: 'Entrance',
    defaults: { duration: 0.9 },
    css: (c) => `
${c.sel} { opacity: 0; transform-origin: 50% -30%; animation: ${c.kf} ${c.dur}s linear ${c.delay}s both; }
@keyframes ${c.kf} { 0% { opacity: 0; transform: rotate(-40deg); } 35% { opacity: 1; transform: rotate(15deg); } 60% { transform: rotate(-8deg); } 82% { transform: rotate(4deg); } 100% { opacity: 1; transform: rotate(0); } }`,
  },

  'spiral-in': {
    id: 'spiral-in',
    label: 'Spiral in',
    hint: 'spirals in from nothing',
    group: 'Entrance',
    hasEasing: true,
    defaults: { duration: 0.85 },
    css: (c) => `
${c.sel} { opacity: 0; animation: ${c.kf} ${c.dur}s ${c.ease} ${c.delay}s both; }
@keyframes ${c.kf} { from { opacity: 0; transform: rotate(-560deg) scale(0.05); } to { opacity: 1; transform: rotate(0) scale(1); } }`,
  },

  stamp: {
    id: 'stamp',
    label: 'Stamp',
    hint: 'slams down like a rubber stamp',
    group: 'Entrance',
    defaults: { duration: 0.45 },
    css: (c) => `
${c.sel} { opacity: 0; animation: ${c.kf} ${c.dur}s cubic-bezier(0.16, 1, 0.3, 1) ${c.delay}s both; }
@keyframes ${c.kf} { 0% { opacity: 0; transform: scale(2.6) rotate(8deg); } 55% { opacity: 1; transform: scale(0.94) rotate(-2deg); } 100% { opacity: 1; transform: scale(1) rotate(0); } }`,
  },

  'fade-drift': {
    id: 'fade-drift',
    label: 'Fade drift',
    hint: 'slow cinematic fade with a gentle drift',
    group: 'Entrance',
    hasDirection: true,
    hasEasing: true,
    defaults: { duration: 1.3 },
    css: (c) => {
      const [x, y] = DIR_OFFSET[c.dir]
      return `
${c.sel} { opacity: 0; animation: ${c.kf} ${c.dur}s ${c.ease} ${c.delay}s both; }
@keyframes ${c.kf} { from { opacity: 0; transform: translate(calc(${x} * 0.55), calc(${y} * 0.55)); } to { opacity: 1; transform: translate(0, 0); } }`
    },
  },

  'flash-in': {
    id: 'flash-in',
    label: 'Flash in',
    hint: 'arrives in a bright flash',
    group: 'Entrance',
    defaults: { duration: 0.6 },
    css: (c) => `
${c.sel} { opacity: 0; animation: ${c.kf} ${c.dur}s ease-out ${c.delay}s both; }
@keyframes ${c.kf} { 0% { opacity: 0; filter: brightness(4); } 30% { opacity: 1; filter: brightness(3); } 100% { opacity: 1; filter: brightness(1); } }`,
  },

  'slide-bounce': {
    id: 'slide-bounce',
    label: 'Slide & bounce',
    hint: 'slides in and overshoots with a bounce',
    group: 'Entrance',
    hasDirection: true,
    defaults: { duration: 0.8 },
    css: (c) => {
      const [x, y] = SLIDE_NUM[c.dir]
      const t = (f: number) => `translate(${round1(x * f)}px, ${round1(y * f)}px)`
      return `
${c.sel} { opacity: 0; animation: ${c.kf} ${c.dur}s linear ${c.delay}s both; }
@keyframes ${c.kf} { 0% { opacity: 0; transform: ${t(1.6)}; } 55% { opacity: 1; transform: ${t(-0.12)}; } 78% { transform: ${t(0.05)}; } 100% { opacity: 1; transform: translate(0, 0); } }`
    },
  },

  /* ================= GENERIC LOOPS ================= */

  float: {
    id: 'float',
    label: 'Float',
    hint: 'gentle up-and-down drift',
    group: 'Loop',
    infinite: true,
    defaults: { duration: 2.6 },
    css: (c) => `
${c.sel} { animation: ${c.kf} ${c.dur}s ease-in-out infinite; }
@keyframes ${c.kf} { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-14px); } }`,
  },

  pulse: {
    id: 'pulse',
    label: 'Pulse',
    hint: 'soft heartbeat scaling',
    group: 'Loop',
    infinite: true,
    defaults: { duration: 1.4 },
    css: (c) => `
${c.sel} { animation: ${c.kf} ${c.dur}s ease-in-out infinite; }
@keyframes ${c.kf} { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.07); } }`,
  },

  spin: {
    id: 'spin',
    label: 'Spin',
    hint: 'continuous rotation',
    group: 'Loop',
    infinite: true,
    defaults: { duration: 6 },
    css: (c) => `
${c.sel} { animation: ${c.kf} ${c.dur}s linear infinite; }
@keyframes ${c.kf} { to { transform: rotate(360deg); } }`,
  },

  swing: {
    id: 'swing',
    label: 'Swing',
    hint: 'pendulum sway from the top',
    group: 'Loop',
    infinite: true,
    defaults: { duration: 2 },
    css: (c) => `
${c.sel} { transform-origin: 50% -20%; animation: ${c.kf} ${c.dur}s ease-in-out infinite; }
@keyframes ${c.kf} { 0%, 100% { transform: rotate(6deg); } 50% { transform: rotate(-6deg); } }`,
  },

  wiggle: {
    id: 'wiggle',
    label: 'Wiggle',
    hint: 'playful rocking wobble',
    group: 'Loop',
    infinite: true,
    defaults: { duration: 0.9 },
    css: (c) => `
${c.sel} { animation: ${c.kf} ${c.dur}s ease-in-out infinite; }
@keyframes ${c.kf} { 0%, 100% { transform: rotate(-4deg); } 50% { transform: rotate(4deg); } }`,
  },

  blink: {
    id: 'blink',
    label: 'Blink',
    hint: 'on-off flashing',
    group: 'Loop',
    infinite: true,
    defaults: { duration: 1 },
    css: (c) => `
${c.sel} { animation: ${c.kf} ${c.dur}s steps(1, end) infinite; }
@keyframes ${c.kf} { 50% { opacity: 0.15; } }`,
  },

  twinkle: {
    id: 'twinkle',
    label: 'Twinkle',
    hint: 'sparkling scale-and-fade shimmer',
    group: 'Loop',
    infinite: true,
    defaults: { duration: 1.8 },
    css: (c) => `
${c.sel} { animation: ${c.kf} ${c.dur}s ease-in-out infinite; }
@keyframes ${c.kf} { 0%, 100% { opacity: 1; transform: scale(1) rotate(0deg); } 50% { opacity: 0.35; transform: scale(0.72) rotate(18deg); } }`,
  },

  heartbeat: {
    id: 'heartbeat',
    label: 'Heartbeat',
    hint: 'double thump like a heartbeat',
    group: 'Loop',
    infinite: true,
    defaults: { duration: 1.6 },
    css: (c) => `
${c.sel} { animation: ${c.kf} ${c.dur}s ease-in-out infinite; }
@keyframes ${c.kf} { 0%, 30%, 100% { transform: scale(1); } 7% { transform: scale(1.16); } 14% { transform: scale(1); } 21% { transform: scale(1.1); } }`,
  },

  breathe: {
    id: 'breathe',
    label: 'Breathe',
    hint: 'slow calm swell and fade',
    group: 'Loop',
    infinite: true,
    defaults: { duration: 3 },
    css: (c) => `
${c.sel} { animation: ${c.kf} ${c.dur}s ease-in-out infinite; }
@keyframes ${c.kf} { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.06); opacity: 0.85; } }`,
  },

  orbit: {
    id: 'orbit',
    label: 'Orbit',
    hint: 'drifts in a small circle',
    group: 'Loop',
    infinite: true,
    defaults: { duration: 3.5 },
    css: (c) => `
${c.sel} { animation: ${c.kf} ${c.dur}s linear infinite; }
@keyframes ${c.kf} { 0%, 100% { transform: translate(0, -12px); } 25% { transform: translate(12px, 0); } 50% { transform: translate(0, 12px); } 75% { transform: translate(-12px, 0); } }`,
  },

  seesaw: {
    id: 'seesaw',
    label: 'Seesaw',
    hint: 'tilts side to side from its base',
    group: 'Loop',
    infinite: true,
    defaults: { duration: 2.2 },
    css: (c) => `
${c.sel} { transform-origin: 50% 100%; animation: ${c.kf} ${c.dur}s ease-in-out infinite; }
@keyframes ${c.kf} { 0%, 100% { transform: rotate(-7deg); } 50% { transform: rotate(7deg); } }`,
  },

  pump: {
    id: 'pump',
    label: 'Pump',
    hint: 'rhythmic squash and stretch',
    group: 'Loop',
    infinite: true,
    defaults: { duration: 1.3 },
    css: (c) => `
${c.sel} { transform-origin: 50% 100%; animation: ${c.kf} ${c.dur}s ease-in-out infinite; }
@keyframes ${c.kf} { 0%, 100% { transform: scale(1, 1); } 30% { transform: scale(1.12, 0.88); } 60% { transform: scale(0.94, 1.08); } }`,
  },

  'glow-pulse': {
    id: 'glow-pulse',
    label: 'Glow pulse',
    hint: 'a colored aura pulses around the layer',
    group: 'Loop',
    infinite: true,
    defaults: { duration: 2 },
    css: (c) => `
${c.sel} { animation: ${c.kf} ${c.dur}s ease-in-out infinite; }
@keyframes ${c.kf} { 0%, 100% { filter: drop-shadow(0 0 3px ${c.colors.from}); } 50% { filter: drop-shadow(0 0 18px ${c.colors.from}); } }`,
  },

  rubber: {
    id: 'rubber',
    label: 'Rubber',
    hint: 'stretchy rubber-band wobble',
    group: 'Loop',
    infinite: true,
    defaults: { duration: 1.8 },
    css: (c) => `
${c.sel} { animation: ${c.kf} ${c.dur}s linear infinite; }
@keyframes ${c.kf} { 0%, 45%, 100% { transform: scale(1, 1); } 10% { transform: scale(1.28, 0.75); } 20% { transform: scale(0.8, 1.2); } 30% { transform: scale(1.12, 0.92); } 38% { transform: scale(0.96, 1.04); } }`,
  },

  tada: {
    id: 'tada',
    label: 'Tada',
    hint: 'celebratory shake-and-grow flourish',
    group: 'Loop',
    infinite: true,
    defaults: { duration: 2 },
    css: (c) => `
${c.sel} { animation: ${c.kf} ${c.dur}s linear infinite; }
@keyframes ${c.kf} { 0%, 55%, 100% { transform: scale(1) rotate(0); } 6%, 12% { transform: scale(0.92) rotate(-3deg); } 18%, 30%, 42% { transform: scale(1.1) rotate(3deg); } 24%, 36% { transform: scale(1.1) rotate(-3deg); } 48% { transform: scale(1) rotate(0); } }`,
  },

  jello: {
    id: 'jello',
    label: 'Jello',
    hint: 'wobbles like jelly, then rests',
    group: 'Loop',
    infinite: true,
    defaults: { duration: 1.8 },
    css: (c) => `
${c.sel} { animation: ${c.kf} ${c.dur}s linear infinite; }
@keyframes ${c.kf} { 0%, 60%, 100% { transform: skew(0, 0); } 12% { transform: skew(-11deg, -6deg); } 22% { transform: skew(8deg, 4deg); } 32% { transform: skew(-5deg, -2deg); } 42% { transform: skew(3deg, 1deg); } 52% { transform: skew(-1deg, 0); } }`,
  },

  'flip-loop': {
    id: 'flip-loop',
    label: 'Coin flip',
    hint: 'spins continuously around its vertical axis',
    group: 'Loop',
    infinite: true,
    defaults: { duration: 2.4 },
    css: (c) => `
${c.layerSel} { perspective: 800px; }
${c.sel} { animation: ${c.kf} ${c.dur}s linear infinite; }
@keyframes ${c.kf} { from { transform: rotateY(0); } to { transform: rotateY(360deg); } }`,
  },

  bounce: {
    id: 'bounce',
    label: 'Bounce',
    hint: 'bounces off the ground and settles',
    group: 'Loop',
    infinite: true,
    defaults: { duration: 1.8 },
    css: (c) => `
${c.sel} { animation: ${c.kf} ${c.dur}s linear infinite; }
@keyframes ${c.kf} { 0%, 85%, 100% { transform: translateY(0); } 20% { transform: translateY(-34px); } 40% { transform: translateY(0); } 55% { transform: translateY(-15px); } 68% { transform: translateY(0); } 77% { transform: translateY(-5px); } }`,
  },

  sway: {
    id: 'sway',
    label: 'Sway',
    hint: 'gentle side-to-side drift',
    group: 'Loop',
    infinite: true,
    defaults: { duration: 2.4 },
    css: (c) => `
${c.sel} { animation: ${c.kf} ${c.dur}s ease-in-out infinite; }
@keyframes ${c.kf} { 0%, 100% { transform: translateX(-12px) rotate(-2deg); } 50% { transform: translateX(12px) rotate(2deg); } }`,
  },

  'ken-burns': {
    id: 'ken-burns',
    label: 'Ken Burns',
    hint: 'slow documentary-style zoom (great for images)',
    group: 'Loop',
    infinite: true,
    defaults: { duration: 8 },
    css: (c) => `
${c.sel} { animation: ${c.kf} ${c.dur}s ease-in-out infinite; }
@keyframes ${c.kf} { 0%, 100% { transform: scale(1) translate(0, 0); } 50% { transform: scale(1.14) translate(2%, -2%); } }`,
  },

  'drift-zoom': {
    id: 'drift-zoom',
    label: 'Drift zoom',
    hint: 'slow pan while zoomed in (great for images)',
    group: 'Loop',
    infinite: true,
    defaults: { duration: 9 },
    css: (c) => `
${c.sel} { animation: ${c.kf} ${c.dur}s ease-in-out infinite; }
@keyframes ${c.kf} { 0%, 100% { transform: scale(1.08) translate(-2%, 1%); } 50% { transform: scale(1.16) translate(2%, -1%); } }`,
  },

  'tilt-3d': {
    id: 'tilt-3d',
    label: '3D tilt',
    hint: 'floats with a subtle 3D wobble',
    group: 'Loop',
    infinite: true,
    defaults: { duration: 4 },
    css: (c) => `
${c.layerSel} { perspective: 700px; }
${c.sel} { animation: ${c.kf} ${c.dur}s ease-in-out infinite; }
@keyframes ${c.kf} { 0%, 100% { transform: rotateX(8deg) rotateY(0); } 25% { transform: rotateX(0) rotateY(10deg); } 50% { transform: rotateX(-8deg) rotateY(0); } 75% { transform: rotateX(0) rotateY(-10deg); } }`,
  },
}

export const ANIM_GROUPS = ['Text entrance', 'Text loop', 'Entrance', 'Loop'] as const

export function animPreset(id: string | undefined | null): AnimPresetDef | null {
  if (!id) return null
  return ANIM_PRESETS[id] ?? null
}

/** Presets applicable to a layer kind, in display-group order. */
export function presetsFor(kind: 'text' | 'shape' | 'image'): AnimPresetDef[] {
  return Object.values(ANIM_PRESETS).filter((p) => (kind === 'text' ? true : !p.textOnly))
}

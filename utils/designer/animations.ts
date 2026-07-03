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

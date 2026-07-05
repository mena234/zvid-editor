import type { DesignDoc, LayerAnim } from './types'
import { makeDesign, makeShapeLayer, makeTextLayer } from './types'

/**
 * Starter designs for the Design Studio — each is a full DesignDoc factory
 * (fresh layer ids per call) that stays 100% editable after applying.
 *
 * NOT bundled at runtime anymore: DesignerModal loads these from the orch
 * content library (`GET /api/library/design-templates` → CDN-hosted JSON,
 * no local copies). This file remains as fixtures for tests/designer.test.ts
 * and as the historical source of the published content. To change a
 * published template, POST the new doc (layer ids stripped) to orch's
 * `/api/admin/library`, or regenerate orch's data/library seeds from here
 * and re-run `node scripts/publish-library.js`.
 */

export interface DesignTemplate {
  id: string
  label: string
  hint: string
  make: () => DesignDoc
}

const anim = (
  preset: string,
  opts: Partial<LayerAnim> = {}
): LayerAnim => ({
  preset,
  duration: opts.duration ?? 0.6,
  delay: opts.delay ?? 0,
  stagger: opts.stagger ?? 0.06,
  easing: opts.easing ?? 'smooth',
  dir: opts.dir ?? 'up',
})

export const DESIGN_TEMPLATES: DesignTemplate[] = [
  {
    id: 'gradient-hero',
    label: 'Gradient hero',
    hint: 'floating blobs + gradient sweep title',
    make: () =>
      makeDesign({
        width: 800,
        height: 450,
        fontFamily: 'Sora',
        background: { kind: 'gradient', color: '#101321', from: '#181c31', to: '#0b0d18', angle: 160, radius: 0 },
        layers: [
          makeShapeLayer({
            name: 'Blob left',
            shape: 'blob',
            x: 16,
            y: 28,
            width: 340,
            height: 330,
            opacity: 0.75,
            fill: { kind: 'gradient', from: '#5b8cff', to: '#9d6bff', angle: 120 },
            anim: anim('float', { duration: 3.2 }),
          }),
          makeShapeLayer({
            name: 'Blob right',
            shape: 'blob',
            x: 86,
            y: 74,
            width: 290,
            height: 280,
            rotate: 140,
            opacity: 0.65,
            fill: { kind: 'gradient', from: '#41c7d4', to: '#3ecf8e', angle: 40 },
            anim: anim('float', { duration: 4 }),
          }),
          makeShapeLayer({
            name: 'Twinkle',
            shape: 'sparkle',
            x: 76,
            y: 22,
            width: 46,
            height: 46,
            fill: { kind: 'solid', color: '#ffd24d' },
            anim: anim('twinkle', { duration: 2.2 }),
          }),
          makeTextLayer({
            name: 'Title',
            text: 'Design bold stories',
            y: 44,
            fontSize: 58,
            fontWeight: '800',
            fill: { kind: 'gradient', from: '#8fb0ff', to: '#c9a5ff', angle: 90 },
            anim: anim('gradient-sweep', { duration: 2.5 }),
          }),
          makeTextLayer({
            name: 'Subtitle',
            text: 'Made with the zvid Design Studio',
            y: 62,
            fontSize: 22,
            fontWeight: '400',
            fill: { kind: 'solid', color: '#aab3d0' },
            anim: anim('word-rise', { delay: 0.5, stagger: 0.12 }),
          }),
        ],
      }),
  },

  {
    id: 'neon-sign',
    label: 'Neon sign',
    hint: 'flickering neon over a spinning dashed ring',
    make: () =>
      makeDesign({
        width: 640,
        height: 460,
        fontFamily: 'Bebas Neue',
        background: { kind: 'solid', color: '#0a0c14', from: '#0a0c14', to: '#0a0c14', angle: 0, radius: 26 },
        layers: [
          makeShapeLayer({
            name: 'Ring',
            shape: 'dashed-ring',
            x: 50,
            y: 47,
            width: 350,
            height: 350,
            strokeWidth: 5,
            opacity: 0.85,
            fill: { kind: 'solid', color: '#2adfff' },
            anim: anim('spin', { duration: 12 }),
          }),
          makeTextLayer({
            name: 'Neon text',
            text: 'NEON',
            y: 44,
            fontSize: 108,
            fontWeight: '700',
            letterSpacing: 0.08,
            fill: { kind: 'gradient', from: '#ff2d78', to: '#ff6ba8', angle: 90 },
            anim: anim('neon', { duration: 3 }),
          }),
          makeTextLayer({
            name: 'Sub',
            text: 'OPEN ALL NIGHT',
            y: 62,
            fontSize: 26,
            letterSpacing: 0.34,
            fontWeight: '400',
            fill: { kind: 'solid', color: '#2adfff' },
            anim: anim('tracking-in', { duration: 1.1, delay: 0.4 }),
          }),
        ],
      }),
  },

  {
    id: 'sunburst-promo',
    label: 'Sunburst promo',
    hint: 'rotating rays, badge and bouncy price',
    make: () =>
      makeDesign({
        width: 640,
        height: 640,
        fontFamily: 'Anton',
        background: { kind: 'gradient', color: '#ff9500', from: '#ffb02e', to: '#ff7a00', angle: 145, radius: 0 },
        layers: [
          makeShapeLayer({
            name: 'Rays',
            shape: 'sunburst',
            x: 50,
            y: 50,
            width: 940,
            height: 940,
            opacity: 0.16,
            fill: { kind: 'solid', color: '#ffffff' },
            anim: anim('spin', { duration: 16 }),
          }),
          makeShapeLayer({
            name: 'Badge',
            shape: 'badge',
            x: 50,
            y: 50,
            width: 430,
            height: 430,
            fill: { kind: 'solid', color: '#fff7ea' },
            anim: anim('pulse', { duration: 2 }),
          }),
          makeTextLayer({
            name: 'Big line',
            text: 'BIG SALE',
            y: 44,
            fontSize: 84,
            fontWeight: '400',
            fill: { kind: 'gradient', from: '#ff5a00', to: '#ff2d55', angle: 180 },
            anim: anim('bounce-in', { duration: 0.8, delay: 0.15 }),
          }),
          makeTextLayer({
            name: 'Small line',
            text: 'UP TO 70% OFF',
            y: 58,
            fontSize: 30,
            letterSpacing: 0.12,
            fontWeight: '400',
            fill: { kind: 'solid', color: '#26160a' },
            anim: anim('letter-pop', { delay: 0.6, stagger: 0.05 }),
          }),
        ],
      }),
  },

  {
    id: 'typewriter-terminal',
    label: 'Terminal typing',
    hint: 'code card with a live typewriter',
    make: () =>
      makeDesign({
        width: 760,
        height: 340,
        fontFamily: 'JetBrains Mono',
        background: { kind: 'solid', color: '#10141f', from: '#10141f', to: '#10141f', angle: 0, radius: 18 },
        layers: [
          makeShapeLayer({ name: 'Dot red', shape: 'circle', x: 6, y: 11, width: 15, height: 15, fill: { kind: 'solid', color: '#f4626e' } }),
          makeShapeLayer({ name: 'Dot yellow', shape: 'circle', x: 9.4, y: 11, width: 15, height: 15, fill: { kind: 'solid', color: '#f5c944' } }),
          makeShapeLayer({ name: 'Dot green', shape: 'circle', x: 12.8, y: 11, width: 15, height: 15, fill: { kind: 'solid', color: '#3ecf8e' } }),
          makeTextLayer({
            name: 'Command',
            text: '$ zvid render project.json\n… rendering 1080p video ✔',
            x: 50,
            y: 56,
            width: 620,
            align: 'left',
            fontSize: 30,
            fontWeight: '500',
            lineHeight: 1.7,
            fill: { kind: 'solid', color: '#7fe3bb' },
            anim: anim('typewriter', { stagger: 0.055 }),
          }),
        ],
      }),
  },

  {
    id: 'sale-sticker',
    label: 'Sale sticker',
    hint: 'wiggling burst with a bold price tag',
    make: () =>
      makeDesign({
        width: 520,
        height: 520,
        fontFamily: 'Archivo',
        background: { kind: 'none', color: '#000', from: '#000', to: '#000', angle: 0, radius: 0 },
        layers: [
          makeShapeLayer({
            name: 'Burst',
            shape: 'burst',
            x: 50,
            y: 50,
            width: 470,
            height: 470,
            fill: { kind: 'gradient', from: '#ffd24d', to: '#ff9950', angle: 180 },
            anim: anim('wiggle', { duration: 1.6 }),
          }),
          makeTextLayer({
            name: 'Percent',
            text: '50%',
            y: 43,
            fontSize: 118,
            fontWeight: '900',
            fill: { kind: 'solid', color: '#221033' },
            anim: anim('bounce-in', { duration: 0.7, delay: 0.1 }),
          }),
          makeTextLayer({
            name: 'Off',
            text: 'OFF',
            y: 62,
            rotate: -5,
            fontSize: 56,
            fontWeight: '900',
            letterSpacing: 0.1,
            fill: { kind: 'solid', color: '#221033' },
            anim: anim('shake', { duration: 0.6 }),
          }),
        ],
      }),
  },

  {
    id: 'lower-third',
    label: 'Lower third',
    hint: 'broadcast-style name plate',
    make: () =>
      makeDesign({
        width: 900,
        height: 220,
        fontFamily: 'Barlow',
        background: { kind: 'none', color: '#000', from: '#000', to: '#000', angle: 0, radius: 0 },
        layers: [
          makeShapeLayer({
            name: 'Plate',
            shape: 'rect',
            x: 34,
            y: 50,
            width: 520,
            height: 110,
            radius: 14,
            fill: { kind: 'gradient', from: '#20263d', to: '#141827', angle: 100 },
            anim: anim('wipe-in', { duration: 0.6, dir: 'left' }),
          }),
          makeShapeLayer({
            name: 'Accent',
            shape: 'bar',
            x: 7,
            y: 50,
            width: 12,
            height: 110,
            radius: 6,
            fill: { kind: 'gradient', from: '#5b8cff', to: '#9d6bff', angle: 180 },
            anim: anim('slide-in', { duration: 0.5, dir: 'left' }),
          }),
          makeTextLayer({
            name: 'Name',
            text: 'Alex Rivera',
            x: 33.5,
            y: 41,
            fontSize: 40,
            fontWeight: '700',
            fill: { kind: 'solid', color: '#ffffff' },
            anim: anim('word-rise', { delay: 0.3, stagger: 0.1 }),
          }),
          makeTextLayer({
            name: 'Role',
            text: 'SENIOR MOTION DESIGNER',
            x: 33.5,
            y: 61,
            fontSize: 19,
            letterSpacing: 0.16,
            fontWeight: '500',
            fill: { kind: 'solid', color: '#9db4ff' },
            anim: anim('word-slide', { delay: 0.55, stagger: 0.09 }),
          }),
        ],
      }),
  },

  {
    id: 'sparkle-heading',
    label: 'Sparkle heading',
    hint: 'waving gradient text with twinkles',
    make: () =>
      makeDesign({
        width: 800,
        height: 360,
        fontFamily: 'Fredoka',
        background: { kind: 'none', color: '#000', from: '#000', to: '#000', angle: 0, radius: 0 },
        layers: [
          makeShapeLayer({
            name: 'Sparkle L',
            shape: 'sparkle',
            x: 15,
            y: 27,
            width: 56,
            height: 56,
            fill: { kind: 'solid', color: '#ffd24d' },
            anim: anim('twinkle', { duration: 1.7 }),
          }),
          makeShapeLayer({
            name: 'Sparkle R',
            shape: 'sparkle',
            x: 84,
            y: 22,
            width: 42,
            height: 42,
            rotate: 20,
            fill: { kind: 'solid', color: '#ff9950' },
            anim: anim('twinkle', { duration: 2.3 }),
          }),
          makeShapeLayer({
            name: 'Sparkle B',
            shape: 'sparkle-sm',
            x: 72,
            y: 76,
            width: 40,
            height: 40,
            fill: { kind: 'solid', color: '#ffd24d' },
            anim: anim('twinkle', { duration: 2 }),
          }),
          makeTextLayer({
            name: 'Heading',
            text: 'Sparkle & Shine',
            y: 50,
            fontSize: 76,
            fontWeight: '600',
            fill: { kind: 'gradient', from: '#ffd24d', to: '#ff8a3d', angle: 100 },
            anim: anim('wave', { duration: 1.4, stagger: 0.09 }),
          }),
        ],
      }),
  },

  {
    id: 'quote-card',
    label: 'Quote card',
    hint: 'word-by-word quote reveal',
    make: () =>
      makeDesign({
        width: 760,
        height: 420,
        fontFamily: 'Playfair Display',
        background: { kind: 'gradient', color: '#1c1430', from: '#241b3a', to: '#131020', angle: 150, radius: 24 },
        layers: [
          makeTextLayer({
            name: 'Quote mark',
            text: '“',
            x: 13,
            y: 26,
            fontSize: 220,
            fontWeight: '700',
            opacity: 0.35,
            fill: { kind: 'solid', color: '#9d6bff' },
            anim: anim('zoom-in', { duration: 0.7, easing: 'overshoot' }),
          }),
          makeTextLayer({
            name: 'Quote',
            text: 'Creativity is intelligence\nhaving fun.',
            y: 50,
            fontSize: 44,
            fontWeight: '600',
            lineHeight: 1.35,
            fill: { kind: 'solid', color: '#f4efff' },
            anim: anim('word-rise', { delay: 0.35, stagger: 0.16 }),
          }),
          makeTextLayer({
            name: 'Author',
            text: '— ALBERT EINSTEIN',
            y: 76,
            fontSize: 19,
            letterSpacing: 0.22,
            fontWeight: '400',
            fill: { kind: 'solid', color: '#b9a8e8' },
            anim: anim('fade-in', { delay: 1.5, duration: 0.8 }),
          }),
        ],
      }),
  },
]

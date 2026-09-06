import { test, expect } from '@playwright/test'
import { fx } from '../e2e/helpers/app'
import { compareImageCase, compareVideoCase } from './helpers/fidelity'

test('filtered images match the complete package render, including crop and alpha', async ({
  page,
}) => {
  const score = await compareImageCase(page, 'ffmpeg-filters-image', {
    type: 'image',
    outputFormat: 'png',
    width: 640,
    height: 480,
    backgroundColor: '#334455',
    visuals: [
      {
        type: 'IMAGE',
        src: fx('image.png'),
        x: 0,
        y: 0,
        width: 320,
        height: 240,
        filter: {
          brightness: 20,
          contrast: -25,
          saturate: 50,
          'hue-rotate': '45deg',
        },
      },
      {
        type: 'IMAGE',
        src: fx('image.png'),
        x: 320,
        y: 0,
        width: 320,
        height: 240,
        radius: { tl: 60, tr: 40, br: 20 },
        filter: { blur: 100, invert: 0.25, colorTint: '#f60' },
      },
      {
        type: 'IMAGE',
        src: fx('image.png'),
        x: 0,
        y: 240,
        width: 320,
        height: 240,
        cropParams: { x: 80, y: 60, width: 160, height: 120 },
        filter: { contrast: 1, colorTint: '#abcdef' },
      },
      {
        type: 'IMAGE',
        src: fx('image.png'),
        x: 320,
        y: 240,
        width: 320,
        height: 240,
        resize: 'contain',
        opacity: 0.5,
        filter: { saturate: -100, blur: 30, invert: true },
      },
    ],
  })
  expect(score, 'see tests/fidelity/.artifacts/ffmpeg-filters-image').toBeGreaterThan(
    0.99
  )
})

test('filtered video matches rendered frames at forward and backward seeks', async ({
  page,
}) => {
  const results = await compareVideoCase(
    page,
    'ffmpeg-filters-video',
    {
      width: 320,
      height: 180,
      duration: 2,
      frameRate: 30,
      backgroundColor: '#334455',
      visuals: [
        {
          type: 'VIDEO',
          src: fx('clip.mp4'),
          width: 320,
          height: 180,
          volume: 0,
          filter: {
            brightness: 10,
            contrast: -20,
            saturate: 50,
            'hue-rotate': '-45deg',
            blur: 10,
            invert: 0.25,
            colorTint: '#abefdc',
          },
        },
      ],
    },
    [0.3, 1.2, 0.2]
  )
  // Final H.264 encoding and browser video decode include chroma rounding.
  for (const { t, score } of results) expect(score, `frame ${t}`).toBeGreaterThan(0.98)
})

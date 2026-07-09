/**
 * Generates the committed deterministic media fixtures used by the E2E suite.
 * Requires ffmpeg on PATH. Re-run only when fixtures need to change:
 *   node tests/e2e/fixtures/generate.mjs
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))
mkdirSync(dir, { recursive: true })

const ff = (args) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], { cwd: dir })

// 2 s 320x180 30fps video with burned frame numbers (frame-accuracy checks) + tone
ff([
  '-f', 'lavfi', '-i', 'color=c=0x2244aa:s=320x180:r=30:d=2',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
  '-vf', "drawtext=text='%{n}':fontsize=64:fontcolor=white:x=(w-tw)/2:y=(h-th)/2",
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-shortest', '-movflags', '+faststart',
  'clip.mp4',
])

// second clip, red, for transition tests
ff([
  '-f', 'lavfi', '-i', 'color=c=0xaa2222:s=320x180:r=30:d=2',
  '-vf', "drawtext=text='B %{n}':fontsize=48:fontcolor=white:x=(w-tw)/2:y=(h-th)/2",
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart',
  'clip-b.mp4',
])

// still image 320x240 (solid + label)
ff([
  '-f', 'lavfi', '-i', 'color=c=0x22aa66:s=320x240:d=1',
  '-vf', "drawtext=text='IMG':fontsize=72:fontcolor=white:x=(w-tw)/2:y=(h-th)/2",
  '-frames:v', '1', 'image.png',
])

// tiny animated gif (1 s, 10 fps)
ff([
  '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=10:duration=1',
  '-loop', '0', 'anim.gif',
])

// single-frame gif (deterministic content for fidelity comparisons —
// animated gif phase is wall-clock in the editor)
ff([
  '-f', 'lavfi', '-i', 'color=c=0xcc6622:s=160x120:d=1',
  '-vf', "drawtext=text='GIF':fontsize=48:fontcolor=white:x=(w-tw)/2:y=(h-th)/2",
  '-frames:v', '1', 'static.gif',
])

// 3 s mp3 tone (audio clips / waveform)
ff([
  '-f', 'lavfi', '-i', 'sine=frequency=330:duration=3',
  '-c:a', 'libmp3lame', '-q:a', '7', 'tone.mp3',
])

// subtitle fixtures
if (!existsSync(join(dir, 'subs.srt'))) {
  writeFileSync(
    join(dir, 'subs.srt'),
    `1
00:00:00,200 --> 00:00:01,400
Hello fixture world

2
00:00:01,600 --> 00:00:02,800
Second caption line
`
  )
}
writeFileSync(
  join(dir, 'subs.vtt'),
  `WEBVTT

00:00.200 --> 00:01.400
Hello fixture world

00:01.600 --> 00:02.800
Second caption line
`
)
writeFileSync(
  join(dir, 'whisper.json'),
  JSON.stringify(
    {
      segments: [
        {
          start: 0.2,
          end: 1.4,
          text: 'Hello fixture world',
          words: [
            { start: 0.2, end: 0.6, word: 'Hello' },
            { start: 0.6, end: 1.0, word: 'fixture' },
            { start: 1.0, end: 1.4, word: 'world' },
          ],
        },
      ],
    },
    null,
    2
  )
)
writeFileSync(
  join(dir, 'shape.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"><circle cx="50" cy="50" r="40" fill="#7c5cff"/></svg>
`
)

console.log('fixtures generated in', dir)

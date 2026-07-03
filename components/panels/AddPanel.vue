<script setup lang="ts">
import { ref, computed } from 'vue'
import { useEditorContext } from '~/composables/useEditorContext'
import { round3 } from '~/utils/time'

const { project, editor, contextDuration } = useEditorContext()

const mediaUrl = ref('')
const mediaKind = ref<null | 'VIDEO' | 'IMAGE' | 'GIF' | 'AUDIO'>(null)
const showShapes = ref(false)

const RECENT_KEY = 'zvid-editor:recent-media'
const recent = ref<{ kind: string; src: string }[]>(loadRecent())

function loadRecent(): { kind: string; src: string }[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
  } catch {
    return []
  }
}
function pushRecent(kind: string, src: string) {
  recent.value = [
    { kind, src },
    ...recent.value.filter((r) => r.src !== src),
  ].slice(0, 12)
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent.value))
}

function defaultTiming() {
  const t0 = round3(Math.min(editor.playhead, Math.max(0, contextDuration.value - 1)))
  return {
    enterBegin: t0 || undefined,
    exitEnd: round3(Math.min(contextDuration.value, t0 + 5)),
  }
}

function addText() {
  const added = project.addVisual(editor.context, {
    type: 'TEXT',
    text: 'Your text here',
    position: 'center-center',
    style: { fontSize: '64px', color: '#ffffff', fontWeight: 'bold' },
    ...defaultTiming(),
  })
  editor.selectVisual(added._id)
  editor.notify('Text added — edit it in the inspector', 'success')
}

const SVG_SHAPES: Record<string, { label: string; svg: string; w: number; h: number }> = {
  rect: {
    label: 'Rectangle',
    w: 400,
    h: 260,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 260"><rect x="8" y="8" width="384" height="244" rx="18" fill="#5b8cff"/></svg>',
  },
  circle: {
    label: 'Circle',
    w: 300,
    h: 300,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><circle cx="150" cy="150" r="140" fill="#9d6bff"/></svg>',
  },
  triangle: {
    label: 'Triangle',
    w: 300,
    h: 300,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><path d="M150 22L282 272H18z" fill="#ff9950"/></svg>',
  },
  diamond: {
    label: 'Diamond',
    w: 300,
    h: 300,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><path d="M150 15L285 150 150 285 15 150z" fill="#41c7d4"/></svg>',
  },
  pentagon: {
    label: 'Pentagon',
    w: 300,
    h: 300,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><path d="M150 16l128 93-49 150H71L22 109z" fill="#3ecf8e"/></svg>',
  },
  hexagon: {
    label: 'Hexagon',
    w: 300,
    h: 300,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><path d="M150 12l120 69v138l-120 69-120-69V81z" fill="#5b8cff"/></svg>',
  },
  star: {
    label: 'Star',
    w: 300,
    h: 300,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><path d="M150 15l41 84 93 13-67 66 16 92-83-44-83 44 16-92-67-66 93-13z" fill="#f5c944"/></svg>',
  },
  heart: {
    label: 'Heart',
    w: 300,
    h: 280,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 280"><path d="M150 266C150 266 28 186 28 102 28 54 66 22 106 22c20 0 37 9 44 24 7-15 24-24 44-24 40 0 78 32 78 80 0 84-122 164-122 164z" fill="#f4626e"/></svg>',
  },
  ring: {
    label: 'Ring',
    w: 300,
    h: 300,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><path d="M150 15a135 135 0 1 0 .1 0zm0 62a73 73 0 1 1-.1 0z" fill="#9d6bff" fill-rule="evenodd"/></svg>',
  },
  halfCircle: {
    label: 'Half circle',
    w: 300,
    h: 160,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 160"><path d="M10 150A140 140 0 0 1 290 150z" fill="#41c7d4"/></svg>',
  },
  cross: {
    label: 'Cross',
    w: 300,
    h: 300,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><path d="M108 18h84v90h90v84h-90v90h-84v-90H18v-84h90z" fill="#3ecf8e"/></svg>',
  },
  bolt: {
    label: 'Lightning',
    w: 240,
    h: 300,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 300"><path d="M138 10L28 170h62l-24 120L212 120h-72z" fill="#f5c944"/></svg>',
  },
  check: {
    label: 'Check',
    w: 300,
    h: 300,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><path d="M42 160l72 72 144-150" stroke="#3ecf8e" stroke-width="42" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  },
  bubble: {
    label: 'Speech bubble',
    w: 300,
    h: 250,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 250"><path d="M48 26h204a26 26 0 0 1 26 26v112a26 26 0 0 1-26 26H136l-58 56 14-56H48a26 26 0 0 1-26-26V52a26 26 0 0 1 26-26z" fill="#5b8cff"/></svg>',
  },
  burst: {
    label: 'Burst',
    w: 300,
    h: 300,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><path d="M150 10l25 55 50-33-8 60 60-8-33 50 55 25-55 25 33 50-60-8 8 60-50-33-25 55-25-55-50 33 8-60-60 8 33-50-55-25 55-25-33-50 60 8-8-60 50 33z" fill="#ff9950"/></svg>',
  },
  line: {
    label: 'Line',
    w: 400,
    h: 20,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 20"><line x1="10" y1="10" x2="390" y2="10" stroke="#ffffff" stroke-width="8" stroke-linecap="round"/></svg>',
  },
  arrow: {
    label: 'Arrow',
    w: 400,
    h: 120,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 120"><path d="M10 60h300M310 60l-70-45M310 60l-70 45" stroke="#3ecf8e" stroke-width="16" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  },
  blob: {
    label: 'Blob',
    w: 300,
    h: 300,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><path d="M62 84c26-45 92-64 138-40s62 82 40 130-84 74-132 52S36 129 62 84z" fill="#41c7d4"/></svg>',
  },
}

function addSvg(shapeKey: string) {
  const shape = SVG_SHAPES[shapeKey]
  const added = project.addVisual(editor.context, {
    type: 'SVG',
    svg: shape.svg,
    width: shape.w,
    height: shape.h,
    position: 'center-center',
    ...defaultTiming(),
  })
  editor.selectVisual(added._id)
}

/* ---------------- HTML canvas presets ----------------
   Full-frame <canvas> overlays driven by customCode JS — the same
   HTML+JS the package captures with Puppeteer at render time. */
const showCanvases = ref(false)

function toggleShapes() {
  showShapes.value = !showShapes.value
  if (showShapes.value) showCanvases.value = false
}
function toggleCanvases() {
  showCanvases.value = !showCanvases.value
  if (showCanvases.value) showShapes.value = false
}

const CANVAS_PRESETS: Record<string, { label: string; hint: string; js: string }> = {
  starfield: {
    label: 'Starfield',
    hint: 'stars flying toward the camera',
    js: `var canvas = document.querySelector('canvas');
var ctx = canvas.getContext('2d');
var W = canvas.width, H = canvas.height;
var stars = [];
for (var i = 0; i < 220; i++) {
  stars.push({ x: Math.random() * W - W / 2, y: Math.random() * H - H / 2, z: Math.random() * W });
}
function frame() {
  ctx.fillStyle = 'rgba(4, 6, 14, 1)';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#ffffff';
  for (var i = 0; i < stars.length; i++) {
    var s = stars[i];
    s.z -= 4;
    if (s.z <= 1) { s.x = Math.random() * W - W / 2; s.y = Math.random() * H - H / 2; s.z = W; }
    var k = 160 / s.z;
    var px = s.x * k + W / 2;
    var py = s.y * k + H / 2;
    if (px >= 0 && px < W && py >= 0 && py < H) {
      var size = (1 - s.z / W) * 3.2;
      ctx.globalAlpha = 1 - s.z / W;
      ctx.fillRect(px, py, size, size);
    }
  }
  ctx.globalAlpha = 1;
  requestAnimationFrame(frame);
}
frame();`,
  },
  confetti: {
    label: 'Confetti',
    hint: 'falling party confetti',
    js: `var canvas = document.querySelector('canvas');
var ctx = canvas.getContext('2d');
var W = canvas.width, H = canvas.height;
var colors = ['#5b8cff', '#9d6bff', '#41c7d4', '#3ecf8e', '#f5c944', '#f4626e', '#ff9950'];
var bits = [];
for (var i = 0; i < 160; i++) {
  bits.push({
    x: Math.random() * W, y: Math.random() * H - H,
    w: 6 + Math.random() * 8, h: 10 + Math.random() * 8,
    vy: 1.6 + Math.random() * 2.6, vx: -0.8 + Math.random() * 1.6,
    rot: Math.random() * Math.PI, vr: -0.08 + Math.random() * 0.16,
    color: colors[i % colors.length]
  });
}
function frame() {
  ctx.clearRect(0, 0, W, H);
  for (var i = 0; i < bits.length; i++) {
    var b = bits[i];
    b.y += b.vy; b.x += b.vx; b.rot += b.vr;
    if (b.y > H + 20) { b.y = -20; b.x = Math.random() * W; }
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.rot);
    ctx.fillStyle = b.color;
    ctx.fillRect(-b.w / 2, -b.h / 2, b.w, Math.max(2, b.h * Math.abs(Math.sin(b.rot))));
    ctx.restore();
  }
  requestAnimationFrame(frame);
}
frame();`,
  },
  particles: {
    label: 'Particle net',
    hint: 'drifting dots linked by lines',
    js: `var canvas = document.querySelector('canvas');
var ctx = canvas.getContext('2d');
var W = canvas.width, H = canvas.height;
var pts = [];
for (var i = 0; i < 70; i++) {
  pts.push({ x: Math.random() * W, y: Math.random() * H, vx: -0.6 + Math.random() * 1.2, vy: -0.6 + Math.random() * 1.2 });
}
var LINK = Math.min(W, H) / 5;
function frame() {
  ctx.clearRect(0, 0, W, H);
  for (var i = 0; i < pts.length; i++) {
    var p = pts[i];
    p.x += p.vx; p.y += p.vy;
    if (p.x < 0 || p.x > W) p.vx *= -1;
    if (p.y < 0 || p.y > H) p.vy *= -1;
  }
  for (var i = 0; i < pts.length; i++) {
    for (var j = i + 1; j < pts.length; j++) {
      var dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < LINK) {
        ctx.globalAlpha = 1 - d / LINK;
        ctx.strokeStyle = '#5b8cff';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(pts[i].x, pts[i].y);
        ctx.lineTo(pts[j].x, pts[j].y);
        ctx.stroke();
      }
    }
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#9ec1ff';
  for (var i = 0; i < pts.length; i++) {
    ctx.beginPath();
    ctx.arc(pts[i].x, pts[i].y, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  requestAnimationFrame(frame);
}
frame();`,
  },
  waves: {
    label: 'Waves',
    hint: 'layered animated sine waves',
    js: `var canvas = document.querySelector('canvas');
var ctx = canvas.getContext('2d');
var W = canvas.width, H = canvas.height;
var layers = [
  { color: 'rgba(91, 140, 255, 0.55)', amp: H * 0.05, speed: 0.9, yoff: 0.72, wl: 1.6 },
  { color: 'rgba(65, 199, 212, 0.5)', amp: H * 0.065, speed: 0.6, yoff: 0.78, wl: 1.1 },
  { color: 'rgba(157, 107, 255, 0.45)', amp: H * 0.08, speed: 0.4, yoff: 0.85, wl: 0.8 }
];
function frame(t) {
  ctx.clearRect(0, 0, W, H);
  for (var l = 0; l < layers.length; l++) {
    var L = layers[l];
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (var x = 0; x <= W; x += 6) {
      var y = H * L.yoff + Math.sin((x / W) * Math.PI * 2 * L.wl + (t || 0) / 1000 * L.speed * Math.PI) * L.amp;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fillStyle = L.color;
    ctx.fill();
  }
  requestAnimationFrame(frame);
}
frame(0);`,
  },
  matrix: {
    label: 'Matrix rain',
    hint: 'green glyph rain',
    js: `var canvas = document.querySelector('canvas');
var ctx = canvas.getContext('2d');
var W = canvas.width, H = canvas.height;
var size = Math.max(14, Math.round(W / 60));
var cols = Math.ceil(W / size);
var drops = [];
for (var i = 0; i < cols; i++) drops.push(Math.floor(Math.random() * H / size));
ctx.fillStyle = '#000';
ctx.fillRect(0, 0, W, H);
function frame() {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
  ctx.fillRect(0, 0, W, H);
  ctx.font = size + 'px monospace';
  for (var i = 0; i < cols; i++) {
    var ch = String.fromCharCode(0x30a0 + Math.floor(Math.random() * 96));
    ctx.fillStyle = '#3ecf8e';
    ctx.fillText(ch, i * size, drops[i] * size);
    if (drops[i] * size > H && Math.random() > 0.975) drops[i] = 0;
    drops[i]++;
  }
  requestAnimationFrame(frame);
}
frame();`,
  },
  bokeh: {
    label: 'Bokeh',
    hint: 'soft floating light orbs',
    js: `var canvas = document.querySelector('canvas');
var ctx = canvas.getContext('2d');
var W = canvas.width, H = canvas.height;
var colors = ['91, 140, 255', '157, 107, 255', '65, 199, 212', '245, 201, 68'];
var orbs = [];
for (var i = 0; i < 26; i++) {
  orbs.push({
    x: Math.random() * W, y: Math.random() * H,
    r: 20 + Math.random() * Math.min(W, H) * 0.08,
    vx: -0.4 + Math.random() * 0.8, vy: -0.4 + Math.random() * 0.8,
    c: colors[i % colors.length], a: 0.12 + Math.random() * 0.25
  });
}
function frame() {
  ctx.clearRect(0, 0, W, H);
  for (var i = 0; i < orbs.length; i++) {
    var o = orbs[i];
    o.x += o.vx; o.y += o.vy;
    if (o.x < -o.r) o.x = W + o.r; if (o.x > W + o.r) o.x = -o.r;
    if (o.y < -o.r) o.y = H + o.r; if (o.y > H + o.r) o.y = -o.r;
    var g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r);
    g.addColorStop(0, 'rgba(' + o.c + ', ' + o.a + ')');
    g.addColorStop(1, 'rgba(' + o.c + ', 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
    ctx.fill();
  }
  requestAnimationFrame(frame);
}
frame();`,
  },
}

function addCanvasPreset(key: string) {
  const preset = CANVAS_PRESETS[key]
  const w = project.defaults.width
  const h = project.defaults.height
  const added = project.addVisual(editor.context, {
    type: 'TEXT',
    html: `<canvas width="${w}" height="${h}" style="display:block;width:100%;height:100%"></canvas>`,
    width: w,
    height: h,
    position: 'center-center',
    customCode: { js: preset.js, animationDuration: 10 },
    ...defaultTiming(),
  })
  editor.selectVisual(added._id)
  editor.notify(`${preset.label} canvas added — tweak its JS under Custom code`, 'success')
}

function addMedia() {
  const src = mediaUrl.value.trim()
  const kind = mediaKind.value
  if (!src || !kind) return
  pushRecent(kind, src)
  if (kind === 'AUDIO') {
    const added = project.addAudio(editor.context, { src })
    editor.selectAudio(added._id)
  } else {
    const added = project.addVisual(editor.context, {
      type: kind,
      src,
      position: 'center-center',
      anchor: 'center-center',
      ...(kind !== 'GIF' ? { resize: 'contain' as const } : {}),
      ...defaultTiming(),
    })
    editor.selectVisual(added._id)
  }
  mediaUrl.value = ''
  mediaKind.value = null
  editor.notify('Element added', 'success')
}

function addRecent(r: { kind: string; src: string }) {
  mediaKind.value = r.kind as any
  mediaUrl.value = r.src
  addMedia()
}

const kindLabel = computed(
  () =>
    (({ VIDEO: 'video', IMAGE: 'image', GIF: 'GIF', AUDIO: 'audio' }) as any)[
      mediaKind.value ?? ''
    ]
)
</script>

<template>
  <div class="add-panel">
    <UiSection title="Add elements">
      <div class="type-grid">
        <button class="type-card" @click="mediaKind = mediaKind === 'VIDEO' ? null : 'VIDEO'">
          <UiIcon name="video" :size="18" />
          Video
        </button>
        <button class="type-card" @click="mediaKind = mediaKind === 'IMAGE' ? null : 'IMAGE'">
          <UiIcon name="image" :size="18" />
          Image
        </button>
        <button class="type-card" @click="mediaKind = mediaKind === 'GIF' ? null : 'GIF'">
          <UiIcon name="gif" :size="18" />
          GIF
        </button>
        <button class="type-card" @click="addText">
          <UiIcon name="text" :size="18" />
          Text
        </button>
        <button class="type-card" @click="mediaKind = mediaKind === 'AUDIO' ? null : 'AUDIO'">
          <UiIcon name="audio" :size="18" />
          Audio
        </button>
        <button
          class="type-card"
          :class="{ open: mediaKind === null && showShapes }"
          @click="toggleShapes"
        >
          <UiIcon name="svg" :size="18" />
          Shape
        </button>
        <button
          class="type-card"
          :class="{ open: mediaKind === null && showCanvases }"
          @click="toggleCanvases"
        >
          <UiIcon name="code" :size="18" />
          Canvas
        </button>
      </div>

      <form v-if="mediaKind" class="url-form" @submit.prevent="addMedia">
        <label class="hint">{{ kindLabel }} URL (or server-local path)</label>
        <input
          v-model="mediaUrl"
          class="ctl"
          type="text"
          :placeholder="`https://… .${mediaKind === 'AUDIO' ? 'mp3' : mediaKind === 'VIDEO' ? 'mp4' : 'png'}`"
          spellcheck="false"
          autofocus
        />
        <div class="row">
          <button type="submit" class="btn primary sm" :disabled="!mediaUrl.trim()">
            Add {{ kindLabel }}
          </button>
          <button type="button" class="btn ghost sm" @click="mediaKind = null">Cancel</button>
        </div>
        <p class="hint">
          The URL must stay reachable by the render machine — remote URLs are the
          automation-friendly choice.
        </p>
      </form>

      <div v-if="showShapes" class="shape-grid">
        <button
          v-for="(s, key) in SVG_SHAPES"
          :key="key"
          class="shape-card"
          :title="s.label"
          @click="addSvg(key as string)"
        >
          <span class="shape-preview" v-html="s.svg" />
          <span>{{ s.label }}</span>
        </button>
      </div>

      <div v-if="showCanvases" class="canvas-list">
        <p class="hint">
          Animated full-frame &lt;canvas&gt; overlays. The JS lives in the
          element's Custom code section — edit it freely after adding.
        </p>
        <button
          v-for="(c, key) in CANVAS_PRESETS"
          :key="key"
          class="canvas-card"
          :title="c.hint"
          @click="addCanvasPreset(key as string)"
        >
          <UiIcon name="code" :size="14" />
          <span class="canvas-name">{{ c.label }}</span>
          <span class="canvas-hint">{{ c.hint }}</span>
        </button>
      </div>
    </UiSection>

    <UiSection v-if="recent.length" title="Recent media" collapsible>
      <button
        v-for="(r, i) in recent"
        :key="i"
        class="recent-row"
        :title="r.src"
        @click="addRecent(r)"
      >
        <UiIcon
          :name="r.kind === 'AUDIO' ? 'audio' : r.kind === 'VIDEO' ? 'video' : 'image'"
          :size="13"
        />
        <span class="recent-src">{{ r.src }}</span>
      </button>
    </UiSection>

    <UiSection title="Tips" collapsible :start-open="false">
      <p class="hint">
        • Drag elements on the canvas; use the timeline to set when they appear.<br />
        • <kbd>S</kbd> splits the selected clip at the playhead.<br />
        • Right-click an element for quick actions.<br />
        • Everything you build exports as zvid JSON — press
        <b>Export JSON</b> when done.
      </p>
    </UiSection>
  </div>
</template>

<style scoped>
.type-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
.type-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  padding: 11px 4px;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-m);
  background: var(--bg-2);
  color: var(--text-1);
  font-size: 10.5px;
  font-weight: 600;
}
.type-card:hover {
  border-color: var(--accent);
  color: var(--text-0);
  background: var(--bg-3);
}
.url-form {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin-top: 10px;
  padding: 10px;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-m);
  background: var(--bg-2);
}
.row {
  display: flex;
  gap: 6px;
}
.shape-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  margin-top: 10px;
}
.shape-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 4px;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-m);
  background: var(--bg-2);
  color: var(--text-2);
  font-size: 10px;
}
.shape-card:hover {
  border-color: var(--accent);
}
.shape-preview {
  width: 44px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.shape-preview :deep(svg) {
  max-width: 100%;
  max-height: 100%;
}
.canvas-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 10px;
}
.canvas-card {
  display: grid;
  grid-template-columns: 20px 1fr;
  grid-template-rows: auto auto;
  column-gap: 7px;
  align-items: center;
  text-align: left;
  padding: 7px 9px;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-m);
  background: var(--bg-2);
  color: var(--text-1);
}
.canvas-card:hover {
  border-color: var(--accent);
  color: var(--text-0);
}
.canvas-card .canvas-name {
  font-size: 11.5px;
  font-weight: 600;
}
.canvas-card .canvas-hint {
  grid-column: 2;
  font-size: 10px;
  color: var(--text-3);
}
.canvas-card :deep(svg) {
  grid-row: span 2;
}
.recent-row {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 5px 7px;
  border: none;
  border-radius: var(--radius-s);
  background: none;
  color: var(--text-1);
  font-size: 11px;
  text-align: left;
}
.recent-row:hover {
  background: var(--bg-3);
  color: var(--text-0);
}
.recent-src {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  direction: rtl;
}
</style>

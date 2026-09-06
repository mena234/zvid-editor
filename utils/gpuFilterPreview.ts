import { gpuFilterSettings } from './gpuFilterMath'
import type { MediaFilter } from './ffmpegFilterGraph'

type Target = {
  texture: WebGLTexture
  framebuffer: WebGLFramebuffer
  width: number
  height: number
}
type Program = {
  program: WebGLProgram
  locations: Map<string, WebGLUniformLocation | null>
}
export interface GpuFrameOptions {
  fit?: string
  crop?: { x: number; y: number; width: number; height: number } | null
  radius?: { tl?: number; tr?: number; br?: number; bl?: number } | null
}

const vertex = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`
const header = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uSource;
out vec4 color;
`
const prepare =
  header +
  `
uniform sampler2D uEq;
uniform vec2 uSize;
uniform vec4 uRect;
uniform vec4 uCorners;
uniform bool uYuv;
uniform ivec2 uHue;
void main() {
  vec2 p = gl_FragCoord.xy;
  vec2 uv = (p - uRect.xy) / uRect.zw;
  vec4 rgba = texture(uSource, clamp(uv, 0.0, 1.0));
  if (rgba.a > 0.0) rgba.rgb /= rgba.a;
  if (any(lessThan(uv, vec2(0))) || any(greaterThan(uv, vec2(1)))) rgba = vec4(0);
  float edge = 1.0;
  if (p.x < uCorners.x && p.y < uCorners.x)
    edge = uCorners.x - length(p - vec2(uCorners.x)) + .5;
  if (p.x > uSize.x - uCorners.y && p.y < uCorners.y)
    edge = uCorners.y - length(p - vec2(uSize.x - uCorners.y, uCorners.y)) + .5;
  if (p.x > uSize.x - uCorners.z && p.y > uSize.y - uCorners.z)
    edge = uCorners.z - length(p - (uSize - vec2(uCorners.z))) + .5;
  if (p.x < uCorners.w && p.y > uSize.y - uCorners.w)
    edge = uCorners.w - length(p - vec2(uCorners.w, uSize.y - uCorners.w)) + .5;
  rgba.a *= clamp(edge, 0.0, 1.0);
  float alpha = floor(rgba.a * 255.0 + .5);
  vec3 premultiplied = floor(rgba.rgb * alpha + .5);
  ivec3 rgb = alpha > 0.0
    ? ivec3(clamp(floor(premultiplied * 255.0 / alpha + .5), 0.0, 255.0)) : ivec3(0);
  if (uYuv) {
    // swscale's default limited-range BT.601 coefficients (15-bit).
    // The extra 256 preserves its intermediate 6-bit rounding offset.
    ivec3 yuv = ivec3(
      (8414 * rgb.r + 16519 * rgb.g + 3208 * rgb.b + 540928) >> 15,
      (-4865 * rgb.r - 9528 * rgb.g + 14392 * rgb.b + 4210944) >> 15,
      (14392 * rgb.r - 12061 * rgb.g - 2332 * rgb.b + 4210944) >> 15);
    yuv = clamp(yuv, 0, 255);
    yuv = ivec3(floor(vec3(
      texelFetch(uEq, ivec2(yuv.r, 0), 0).r,
      texelFetch(uEq, ivec2(yuv.g, 0), 0).g,
      texelFetch(uEq, ivec2(yuv.b, 0), 0).b) * 255.0 + .5));
    ivec2 uv2 = yuv.gb - 128;
    yuv.gb = clamp(ivec2(
      (uHue.x * uv2.x - uHue.y * uv2.y + 8421376) >> 16,
      (uHue.y * uv2.x + uHue.x * uv2.y + 8421376) >> 16), 0, 255);
    rgb = yuv;
  }
  color = vec4(vec3(rgb) / 255.0, alpha / 255.0);
}`

// Build sums for 2/4/8/16-pixel blocks. The sum textures are small and reused.
const reduce =
  header +
  `
uniform ivec2 uAxis;
uniform ivec2 uInputSize;
uniform float uScale;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy) * (ivec2(1) + uAxis);
  vec4 a = texelFetch(uSource, p, 0);
  ivec2 next = p + uAxis;
  vec4 b = all(lessThan(next, uInputSize)) ? texelFetch(uSource, next, 0) : vec4(0);
  color = uScale == 255.0
    ? floor(a * 255.0 + .5) + floor(b * 255.0 + .5) : a + b;
}`
const scan =
  header +
  `
uniform ivec2 uAxis;
uniform int uStep;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 before = p - uAxis * uStep;
  color = texelFetch(uSource, p, 0);
  if (all(greaterThanEqual(before, ivec2(0)))) color += texelFetch(uSource, before, 0);
}`
const blur =
  header +
  `
uniform sampler2D uTwo;
uniform sampler2D uFour;
uniform sampler2D uEight;
uniform sampler2D uPrefix;
uniform ivec2 uAxis;
uniform int uLength;
uniform int uRadius;
uniform float uInverse;
ivec2 at(int x, int row) { return uAxis.x == 1 ? ivec2(x, row) : ivec2(row, x); }
// Sum of [0, count): complete 16-pixel blocks plus at most four small blocks.
vec3 prefix(int count, int row) {
  int blocks = count / 16;
  vec3 sum = blocks > 0 ? texelFetch(uPrefix, at(blocks - 1, row), 0).rgb : vec3(0);
  int pos = blocks * 16;
  if ((count & 8) != 0) { sum += texelFetch(uEight, at(pos / 8, row), 0).rgb; pos += 8; }
  if ((count & 4) != 0) { sum += texelFetch(uFour, at(pos / 4, row), 0).rgb; pos += 4; }
  if ((count & 2) != 0) { sum += texelFetch(uTwo, at(pos / 2, row), 0).rgb; pos += 2; }
  if ((count & 1) != 0) sum += floor(texelFetch(uSource, at(pos, row), 0).rgb * 255.0 + .5);
  return sum;
}
vec3 extendedPrefix(int count, int row) {
  if (count < 0) return -prefix(-count, row);
  if (count > uLength) return 2.0 * prefix(uLength, row) - prefix(2 * uLength - count, row);
  return prefix(count, row);
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int x = uAxis.x == 1 ? p.x : p.y;
  int row = uAxis.x == 1 ? p.y : p.x;
  vec3 sum = extendedPrefix(x + uRadius + 1, row) - extendedPrefix(x - uRadius, row);
  // Match boxblur's fixed-point reciprocal, rounding, and 8-bit storage.
  ivec3 value = ivec3(floor((sum * uInverse + 32768.0) / 65536.0)) & 255;
  color = vec4(vec3(value) / 255.0, 1.0);
}`
const finish =
  header +
  `
uniform sampler2D uOriginal;
uniform sampler2D uRgb;
uniform int uHeight;
uniform bool uYuv;
void main() {
  ivec2 p = ivec2(int(gl_FragCoord.x), uHeight - 1 - int(gl_FragCoord.y));
  vec3 value = floor(texelFetch(uSource, p, 0).rgb * 255.0 + .5);
  if (uYuv) {
    float y = (value.r - 16.0) * (255.0 / 219.0);
    vec2 uv = value.gb - 128.0;
    value = floor(vec3(y + 1.596027 * uv.y,
      y - .391762 * uv.x - .812968 * uv.y, y + 2.017232 * uv.x) + .5);
  }
  ivec3 rgb = ivec3(clamp(value, 0.0, 255.0));
  color = vec4(
    texelFetch(uRgb, ivec2(rgb.r, 0), 0).r,
    texelFetch(uRgb, ivec2(rgb.g, 0), 0).g,
    texelFetch(uRgb, ivec2(rgb.b, 0), 0).b,
    texelFetch(uOriginal, p, 0).a);
}`

/**
 * One WebGL2 context for the entire stage. No pixel readback, WASM execution,
 * or CPU frame copies during playback. CPU work is small parameter LUTs only.
 * Color intermediates are 8-bit; prefix sums are float32 integers (not half).
 */
export class GpuFilterPreview {
  readonly canvas = document.createElement('canvas')
  private gl: WebGL2RenderingContext
  private programs: Record<string, Program> = {}
  private input: WebGLTexture
  private eq: WebGLTexture
  private rgb: WebGLTexture
  private targets = new Map<string, Target>()
  private pools = new Map<string, Map<string, Target>>()
  private maxTextureSize: number
  private settingsKey = ''
  private settings?: ReturnType<typeof gpuFilterSettings>
  private width = 0
  private height = 0

  constructor() {
    const gl = this.canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    })
    if (!gl || !gl.getExtension('EXT_color_buffer_float')) {
      gl?.getExtension('WEBGL_lose_context')?.loseContext()
      throw new Error('GPU filter preview is unavailable')
    }
    this.gl = gl
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE)
    gl.disable(gl.DITHER)
    gl.disable(gl.BLEND)
    this.input = this.texture(true)
    this.eq = this.texture()
    this.rgb = this.texture()
    try {
      for (const [name, fragment] of Object.entries({
        prepare,
        reduce,
        scan,
        blur,
        finish,
      }))
        this.programs[name] = this.program(fragment)
    } catch (error) {
      this.dispose()
      throw error
    }
  }

  private texture(linear = false) {
    const g = this.gl,
      texture = g.createTexture()!
    g.bindTexture(g.TEXTURE_2D, texture)
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, linear ? g.LINEAR : g.NEAREST)
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, linear ? g.LINEAR : g.NEAREST)
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE)
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE)
    return texture
  }
  private program(fragment: string): Program {
    const g = this.gl,
      program = g.createProgram()!
    for (const [kind, source] of [
      [g.VERTEX_SHADER, vertex],
      [g.FRAGMENT_SHADER, fragment],
    ] as const) {
      const shader = g.createShader(kind)!
      g.shaderSource(shader, source)
      g.compileShader(shader)
      if (!g.getShaderParameter(shader, g.COMPILE_STATUS)) {
        const message = g.getShaderInfoLog(shader)
        g.deleteShader(shader)
        g.deleteProgram(program)
        throw new Error(message ?? 'GPU filter compilation failed')
      }
      g.attachShader(program, shader)
      g.deleteShader(shader)
    }
    g.linkProgram(program)
    if (!g.getProgramParameter(program, g.LINK_STATUS)) {
      const message = g.getProgramInfoLog(program)
      g.deleteProgram(program)
      throw new Error(message ?? 'GPU filter linking failed')
    }
    return { program, locations: new Map() }
  }
  private target(name: string, width: number, height: number, floating = false) {
    let target = this.targets.get(name)
    if (target) return target
    const g = this.gl,
      texture = this.texture(),
      framebuffer = g.createFramebuffer()!
    g.texImage2D(
      g.TEXTURE_2D,
      0,
      floating ? g.RGBA32F : g.RGBA8,
      width,
      height,
      0,
      g.RGBA,
      floating ? g.FLOAT : g.UNSIGNED_BYTE,
      null
    )
    g.bindFramebuffer(g.FRAMEBUFFER, framebuffer)
    g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, texture, 0)
    if (g.checkFramebufferStatus(g.FRAMEBUFFER) !== g.FRAMEBUFFER_COMPLETE) {
      g.deleteTexture(texture)
      g.deleteFramebuffer(framebuffer)
      throw new Error('GPU filter buffer is unavailable')
    }
    target = { texture, framebuffer, width, height }
    this.targets.set(name, target)
    return target
  }
  private draw(
    name: string,
    target: Target | null,
    textures: Record<string, WebGLTexture>,
    uniforms: Record<string, number | number[] | boolean>
  ) {
    const g = this.gl,
      p = this.programs[name]!
    g.useProgram(p.program)
    g.bindFramebuffer(g.FRAMEBUFFER, target?.framebuffer ?? null)
    g.viewport(0, 0, target?.width ?? this.width, target?.height ?? this.height)
    const location = (key: string) => {
      if (!p.locations.has(key))
        p.locations.set(key, g.getUniformLocation(p.program, key))
      return p.locations.get(key)!
    }
    let unit = 0
    for (const [key, texture] of Object.entries(textures)) {
      g.activeTexture(g.TEXTURE0 + unit)
      g.bindTexture(g.TEXTURE_2D, texture)
      g.uniform1i(location(key), unit++)
    }
    for (const [key, value] of Object.entries(uniforms)) {
      const loc = location(key)
      if (typeof value === 'boolean') g.uniform1i(loc, +value)
      else if (Array.isArray(value)) {
        if (['uAxis', 'uInputSize', 'uHue'].includes(key)) g.uniform2iv(loc, value)
        else if (value.length === 2) g.uniform2fv(loc, value)
        else g.uniform4fv(loc, value)
      } else if (['uLength', 'uRadius', 'uStep', 'uHeight'].includes(key))
        g.uniform1i(loc, value)
      else g.uniform1f(loc, value)
    }
    g.drawArrays(g.TRIANGLES, 0, 3)
  }

  private boxPass(
    source: Target,
    destination: Target,
    vertical: boolean,
    radius: number
  ) {
    const axis = vertical ? [0, 1] : [1, 0]
    const length = vertical ? this.height : this.width
    const tag = vertical ? 'v' : 'h'
    let previous = source
    const levels: Target[] = []
    for (let level = 1; level <= 4; level++) {
      const size = Math.ceil(length / (1 << level))
      const target = this.target(
        tag + level,
        vertical ? this.width : size,
        vertical ? size : this.height,
        true
      )
      this.draw(
        'reduce',
        target,
        { uSource: previous.texture },
        {
          uAxis: axis,
          uInputSize: [previous.width, previous.height],
          uScale: level === 1 ? 255 : 1,
        }
      )
      levels.push(target)
      previous = target
    }
    const blocks = Math.ceil(length / 16)
    for (let step = 1, n = 0; step < blocks; step *= 2, n++) {
      const target = this.target(
        tag + 'scan' + (n % 2),
        previous.width,
        previous.height,
        true
      )
      this.draw(
        'scan',
        target,
        { uSource: previous.texture },
        { uAxis: axis, uStep: step }
      )
      previous = target
    }
    this.draw(
      'blur',
      destination,
      {
        uSource: source.texture,
        uTwo: levels[0]!.texture,
        uFour: levels[1]!.texture,
        uEight: levels[2]!.texture,
        uPrefix: previous.texture,
      },
      {
        uAxis: axis,
        uLength: length,
        uRadius: radius,
        uInverse: Math.floor((65536 + (radius * 2 + 1) / 2) / (radius * 2 + 1)),
      }
    )
  }

  render(
    source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
    width: number,
    height: number,
    filter: MediaFilter,
    options: GpuFrameOptions = {}
  ) {
    const g = this.gl
    if (g.isContextLost()) throw new Error('GPU filter context was lost')
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1 ||
      width * height > 4096 * 4096 ||
      Math.max(width, height) > this.maxTextureSize
    )
      throw new Error('Invalid GPU filter dimensions')
    if (width !== this.width || height !== this.height) {
      const poolKey = width + 'x' + height
      const pool = this.pools.get(poolKey) ?? new Map<string, Target>()
      this.pools.delete(poolKey)
      this.pools.set(poolKey, pool)
      // Different-sized stage items must not allocate all their textures again
      // on every frame. Keep a bounded LRU of size-specific buffers.
      const pixels = () =>
        [...this.pools.keys()].reduce((total, key) => {
          const [w, h] = key.split('x').map(Number)
          return total + w! * h!
        }, 0)
      while (this.pools.size > 1 && (this.pools.size > 3 || pixels() > 3840 * 2160)) {
        const oldest = this.pools.keys().next().value!
        this.clearTargets(this.pools.get(oldest)!)
        this.pools.delete(oldest)
      }
      this.targets = pool
      this.width = this.canvas.width = width
      this.height = this.canvas.height = height
    }
    const key = JSON.stringify([filter, width, height])
    if (key !== this.settingsKey) {
      this.settings = gpuFilterSettings(filter, width, height)
      this.settingsKey = key
      for (const [texture, data] of [
        [this.eq, this.settings.eq],
        [this.rgb, this.settings.rgb],
      ] as const) {
        g.bindTexture(g.TEXTURE_2D, texture)
        g.texImage2D(g.TEXTURE_2D, 0, g.RGBA8, 256, 1, 0, g.RGBA, g.UNSIGNED_BYTE, data)
      }
    }
    const settings = this.settings!
    g.activeTexture(g.TEXTURE0)
    g.bindTexture(g.TEXTURE_2D, this.input)
    g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, false)
    g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA8, g.RGBA, g.UNSIGNED_BYTE, source)
    const sw =
      source instanceof HTMLVideoElement
        ? source.videoWidth
        : source instanceof HTMLImageElement
          ? source.naturalWidth
          : source.width
    const sh =
      source instanceof HTMLVideoElement
        ? source.videoHeight
        : source instanceof HTMLImageElement
          ? source.naturalHeight
          : source.height
    let rect = [0, 0, width, height]
    if (options.crop && options.crop.width > 0 && options.crop.height > 0) {
      const c = options.crop
      rect = [
        (-c.x * width) / c.width,
        (-c.y * height) / c.height,
        (sw * width) / c.width,
        (sh * height) / c.height,
      ]
    } else if (options.fit === 'contain' || options.fit === 'cover') {
      const scale = (options.fit === 'contain' ? Math.min : Math.max)(
        width / sw,
        height / sh
      )
      rect = [(width - sw * scale) / 2, (height - sh * scale) / 2, sw * scale, sh * scale]
    }
    const r = options.radius
    const corners = [r?.tl ?? 0, r?.tr ?? 0, r?.br ?? 0, r?.bl ?? 0].map((n) =>
      Math.max(0, n)
    )
    const cornerScale = Math.min(
      1,
      width / Math.max(1, corners[0]! + corners[1]!),
      width / Math.max(1, corners[2]! + corners[3]!),
      height / Math.max(1, corners[0]! + corners[3]!),
      height / Math.max(1, corners[1]! + corners[2]!)
    )
    const first = this.target('first', width, height)
    this.draw(
      'prepare',
      first,
      { uSource: this.input, uEq: this.eq },
      {
        uSize: [width, height],
        uRect: rect,
        uCorners: corners.map((n) => n * cornerScale),
        uYuv: settings.yuv,
        uHue: settings.hue,
      }
    )
    let last = first
    if (settings.radius > 0) {
      const a = this.target('a', width, height),
        b = this.target('b', width, height)
      // FFmpeg applies both horizontal passes before both vertical passes.
      for (let i = 0; i < 4; i++) {
        const next = i % 2 === 0 ? a : b
        this.boxPass(last, next, i >= 2, settings.radius)
        last = next
      }
    }
    this.draw(
      'finish',
      null,
      { uSource: last.texture, uOriginal: first.texture, uRgb: this.rgb },
      { uYuv: settings.yuv, uHeight: height }
    )
    return this.canvas
  }

  private clearTargets(targets: Map<string, Target>) {
    for (const target of targets.values()) {
      this.gl.deleteTexture(target.texture)
      this.gl.deleteFramebuffer(target.framebuffer)
    }
    targets.clear()
  }
  dispose() {
    for (const pool of this.pools.values()) this.clearTargets(pool)
    this.pools.clear()
    for (const { program } of Object.values(this.programs)) this.gl.deleteProgram(program)
    for (const texture of [this.input, this.eq, this.rgb]) this.gl.deleteTexture(texture)
    if (!this.gl.isContextLost())
      this.gl.getExtension('WEBGL_lose_context')?.loseContext()
    this.canvas.width = this.canvas.height = 0
  }
  get available() {
    return !this.gl.isContextLost()
  }
}

let shared: GpuFilterPreview | undefined
let users = 0
let idle: ReturnType<typeof setTimeout> | undefined
export function retainGpuPreview() {
  clearTimeout(idle)
  users++
  let released = false
  return () => {
    if (released) return
    released = true
    if (--users === 0)
      idle = setTimeout(() => {
        shared?.dispose()
        shared = undefined
      }, 30_000)
  }
}
export function renderGpuPreview(...args: Parameters<GpuFilterPreview['render']>) {
  if (shared && !shared.available) {
    shared.dispose()
    shared = undefined
  }
  shared ??= new GpuFilterPreview()
  return shared.render(...args)
}

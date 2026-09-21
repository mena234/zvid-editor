/**
 * jassub 2.5.6 auto-picks a WebGL renderer in its worker, which rasterizes to
 * a fully INVISIBLE canvas on some Windows/ANGLE GPU stacks — no error, no
 * fallback, subtitles just never appear (verified 2026-07-27 with compositor
 * screenshot A/B: WebGL = 0 painted pixels, Canvas2D = correct captions).
 * Throwing before its renderer probe drops it into the try/catch's
 * Canvas2DRenderer path, which paints correctly everywhere; libass does the
 * heavy rasterizing in wasm either way, the renderer only blits bitmaps.
 * The transform is a no-op if the probe line changes in a future jassub —
 * re-verify rendering when upgrading the package.
 */
const JASSUB_GL_PROBE = 'const testCanvas = new OffscreenCanvas(1, 1);'
const forceJassubCanvas2D = {
  name: 'zvid:jassub-force-canvas2d',
  transform(code: string, id: string) {
    if (!id.includes('jassub') || !code.includes(JASSUB_GL_PROBE)) return
    return code.replace(
      JASSUB_GL_PROBE,
      `throw new Error('zvid: forcing Canvas2D renderer'); ${JASSUB_GL_PROBE}`
    )
  },
}

/** Nuxt supplies a process shim in browsers; ICU must use its browser loader. */
const forceIcuBrowserLoader = {
  name: 'zvid:icu-browser-loader',
  transform(code: string, id: string) {
    if (!id.split('?')[0]!.replaceAll('\\', '/').endsWith('/icu/lib/diplomat-wasm.mjs')) return
    const nodeLoaderStart = code.indexOf('if (globalThis.process?.getBuiltinModule) {')
    const initializerStart = code.indexOf('wasm.diplomat_init();')
    if (nodeLoaderStart < 0 || initializerStart < nodeLoaderStart) {
      throw new Error('The pinned ICU loader changed; verify its browser initialization before upgrading.')
    }
    return code.slice(0, nodeLoaderStart)
      + `const loadedWasm = await WebAssembly.instantiateStreaming(fetch(cfg['wasm_path']), imports);\nwasm = loadedWasm.instance.exports;\n\n`
      + code.slice(initializerStart)
  },
}

export default defineNuxtConfig({
  compatibilityDate: '2025-07-01',
  ssr: false,
  devtools: { enabled: false },
  modules: ['@pinia/nuxt', '@sentry/nuxt/module'],
  css: ['~/assets/css/main.css'],

  app: {
    head: {
      title: 'Zvid Editor',
      htmlAttrs: { lang: 'en' },
      script: [
        {
          // set the theme before first paint to avoid a flash of the wrong mode
          innerHTML:
            "(function(){try{var t=localStorage.getItem('zvid-theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.setAttribute('data-theme',t)}catch(e){document.documentElement.setAttribute('data-theme','light')}})()",
        },
        {
          // Microsoft Clarity analytics
          innerHTML:
            '(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","xkuwuyq4uy")',
        },
        {
          key: 'tawk-to',
          tagPosition: 'bodyClose',
          innerHTML:
            'var Tawk_API=Tawk_API||{},Tawk_LoadStart=new Date();(function(){var s1=document.createElement("script"),s0=document.getElementsByTagName("script")[0];s1.async=true;s1.src="https://embed.tawk.to/6a54e8f61df89a1d45ebaa2a/1jtdqs1ga";s1.charset="UTF-8";s1.setAttribute("crossorigin","*");s0.parentNode.insertBefore(s1,s0);})();',
        },
      ],
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        {
          name: 'robots',
          content: 'noindex, nofollow, noarchive',
        },
        {
          name: 'description',
          content:
            'Visual editor for zvid — compose videos on a stage and timeline, export automation-ready JSON.',
        },
      ],
      link: [
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        {
          rel: 'preconnect',
          href: 'https://fonts.gstatic.com',
          crossorigin: '',
        },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',
        },
      ],
    },
  },

  routeRules: {
    '/**': {
      headers: {
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
      },
    },
  },

  nitro: {
    compressPublicAssets: true,
  },

  runtimeConfig: {
    // Base URL of the orch API service (server-side proxies: stock, projects…).
    orchUrl: process.env.ORCH_URL || 'http://localhost:4000',
    public: {
      // orch base URL the browser connects to directly (render websocket).
      orchUrl: process.env.NUXT_PUBLIC_ORCH_URL || 'http://localhost:4000',
      // Dashboard app URL (register / forgot-password / template management links).
      dashUrl: process.env.NUXT_PUBLIC_DASH_URL || 'http://localhost:3001',
    },
  },

  vite: {
    // ICU4X's pinned WebAssembly module initializes with top-level await.
    build: { target: 'es2022' },
    define: {
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
    },
    // dev serves the worker file through the main transform pipeline…
    plugins: [forceJassubCanvas2D, forceIcuBrowserLoader],
    // jassub's worker contains dynamic imports; vite's default iife worker
    // format can't code-split, so production builds fail without this.
    // …but production bundles workers with their own plugin list.
    worker: { format: 'es', plugins: () => [forceJassubCanvas2D] },
    optimizeDeps: {
      // jassub resolves its worker/wasm via `new URL(..., import.meta.url)`;
      // pre-bundling would break those relative asset URLs.
      exclude: ['jassub', '@ffmpeg/ffmpeg', '@ffmpeg/core', 'icu'],
      // …but its CommonJS deps still need the ESM interop pre-bundle
      // ("excluded parent > cjs child" form).
      include: [
        'jassub > throughput',
        'jassub > rvfc-polyfill',
        'jassub > abslink',
        'jassub > abslink/w3c',
      ],
    },
  },

  sentry: {
    org: 'zvid',
    project: 'editor',
  },

  sourcemap: {
    client: 'hidden',
  },
})

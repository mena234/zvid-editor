export default defineNuxtConfig({
  compatibilityDate: '2025-07-01',
  ssr: false,
  devtools: { enabled: false },
  modules: ['@pinia/nuxt'],
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
    define: {
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
    },
    // jassub's worker contains dynamic imports; vite's default iife worker
    // format can't code-split, so production builds fail without this.
    worker: { format: 'es' },
    optimizeDeps: {
      // jassub resolves its worker/wasm via `new URL(..., import.meta.url)`;
      // pre-bundling would break those relative asset URLs.
      exclude: ['jassub'],
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
})

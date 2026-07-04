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
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        {
          name: 'description',
          content:
            'Visual editor for zvid — compose videos on a stage and timeline, export automation-ready JSON.',
        },
      ],
      link: [
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
    // Absolute or relative (to the editor cwd) path of the built zvid package entry.
    zvidPackagePath: process.env.ZVID_PACKAGE_PATH || '../package/dist/index.cjs',
    // Base URL of the orch API service (stock media search proxy lives there).
    orchUrl: process.env.ORCH_URL || 'http://localhost:4000',
    renderEnabled: process.env.NUXT_RENDER_ENABLED !== 'false',
    public: {
      renderEnabled: process.env.NUXT_RENDER_ENABLED !== 'false',
    },
  },
  vite: {
    define: {
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
    },
  },
})

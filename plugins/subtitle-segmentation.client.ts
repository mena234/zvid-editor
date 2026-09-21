import { configureSubtitleSegmentation } from '~/shared/ass/vendor/utils/subtitleSegmentation'

/** Complete the pinned dictionary load before stores import or normalize captions. */
export default defineNuxtPlugin({
  name: 'subtitle-segmentation',
  enforce: 'pre',
  async setup() {
    try {
      const icu = await import('icu')
      configureSubtitleSegmentation(icu)
    } catch (cause) {
      throw createError({
        statusCode: 503,
        statusMessage: 'Subtitle language support could not load. Check your connection and reload the editor.',
        cause,
        fatal: true,
      })
    }
  },
})

import type { Caption, Subtitle } from './vendor/types/text'
import { formatASSTime, escapeAssText, transformTextCase } from './vendor/utils/subtitles'
import generateHeader from './vendor/lib/subtitles/content/generateHeader'
import configInstance from './vendor/lib/config/config'
import prepareRoundedBoxes from './vendor/lib/subtitles/roundedBoxes'
import { generateASSContent as generateASSContentWordByWord } from './vendor/lib/subtitles/modes/subtitle-one-word'
import { generateASSContent as generateASSContentSentenceByWord } from './vendor/lib/subtitles/modes/subtitle-progressive'
import { generateASSContent as generateASSContentKaraoke } from './vendor/lib/subtitles/modes/subtitle-karaoke'
import { generateASSContent as generateASSContentWordScale } from './vendor/lib/subtitles/modes/subtitle-word-scale'
import { generateASSContent as generateASSContentFade } from './vendor/lib/subtitles/modes/subtitle-fade'
import { generateASSContent as generateASSContentTypewriter } from './vendor/lib/subtitles/modes/subtitle-typewriter'
import { generateASSContent as generateASSContentFill } from './vendor/lib/subtitles/modes/subtitle-fill'
import { generateASSContent as generateASSContentSlide } from './vendor/lib/subtitles/modes/subtitle-slide'

/**
 * Browser port of package/src/lib/subtitles/content/buildAssFile.ts — builds
 * the exact ASS content the renderer feeds to libass, minus the file write.
 * KEEP IN LOCKSTEP with the package (same rule as shared/schema).
 *
 * `subtitle` is the internal `{captions, styles}` shape (the editor's stored
 * model); callers pass a deep clone — the transform mutates captions/styles
 * exactly like the package does.
 */
export async function buildAssContent(
  subtitle: Subtitle,
  project: { width: number; height: number }
): Promise<string> {
  configInstance.updateConfig({ width: project.width, height: project.height })

  const { styles = {}, captions = [] } = subtitle
  const { width: projectWidth, height: projectHeight } = configInstance.getConfig()

  // default marginVertically is 5% of project height, but can be overridden by marginV (0 is valid)
  styles.marginV = Math.round(styles.marginV ?? projectHeight * 0.05)
  // default marginHorizontally is 5% of project width, but can be overridden by marginH (0 is valid)
  styles.marginH = Math.round(styles.marginH ?? projectWidth * 0.05)
  styles.color = styles.color || '#ffffff'
  styles.fontSize = styles.fontSize || 50
  styles.fontFamily = styles.fontFamily || 'Poppins'
  subtitle.styles = styles

  const { textTransform, mode, marginH, marginV } = styles

  const transformedCaptions = captions.map((sentence: Caption) => ({
    ...sentence,
    text: transformTextCase(sentence, textTransform),
  }))
  subtitle.captions = transformedCaptions

  const rounded = await prepareRoundedBoxes(subtitle)
  const headerStyles = rounded ? rounded.stylesForText : styles
  const assHeader = generateHeader(
    headerStyles,
    rounded ? { wrapStyle: 1, extraStyleLines: rounded.styleLines } : undefined
  )

  let assBody: string

  if (mode === 'one-word') {
    assBody = generateASSContentWordByWord(subtitle)
  } else if (mode === 'progressive') {
    assBody = generateASSContentSentenceByWord(subtitle)
  } else if (mode === 'karaoke' || mode === 'highlight') {
    assBody = generateASSContentKaraoke(subtitle)
  } else if (mode === 'pop' || mode === 'bounce') {
    assBody = generateASSContentWordScale(subtitle, mode)
  } else if (mode === 'fade') {
    assBody = generateASSContentFade(subtitle)
  } else if (mode === 'typewriter') {
    assBody = generateASSContentTypewriter(subtitle)
  } else if (mode === 'fill') {
    assBody = generateASSContentFill(subtitle)
  } else if (mode === 'slide') {
    assBody = generateASSContentSlide(subtitle)
  } else {
    // 'normal', 'none', or unset: static captions
    assBody = transformedCaptions
      .map((caption: any) => {
        const start = formatASSTime(caption.start)
        const end = formatASSTime(caption.end)
        return `Dialogue: 0,${start},${end},Default,,${marginH},${marginH},${marginV},,${escapeAssText(caption.text)}`
      })
      .join('\n')
  }

  return `${assHeader}${rounded ? rounded.events : ''}${assBody}`
}

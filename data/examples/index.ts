import animatedHtmlElements from './animated-html-elements.json'
import inspirationalVideo from './inspirational-video.json'
import pizzaMargheritaReel from './pizza-margherita-reel.json'
import promoGolden from './promo-golden.json'
import scenesDemo from './scenes-demo.json'
import usedCarDealerPromo from './used-car-dealer-promo.json'
import zvidAd from './zvid-ad.json'

export interface ExampleEntry {
  slug: string
  title: string
  description: string
  config: Record<string, any>
}

export const EXAMPLES: ExampleEntry[] = [
  {
    slug: 'pizza-margherita-reel',
    title: 'Pizza Margherita Reel',
    description: 'Instagram reel — image sequence, voice-over, karaoke subtitles.',
    config: pizzaMargheritaReel as any,
  },
  {
    slug: 'scenes-demo',
    title: 'Scenes Demo',
    description: 'Three scenes with xfade transitions, video clip and overlays.',
    config: scenesDemo as any,
  },
  {
    slug: 'animated-html-elements',
    title: 'Animated HTML Elements',
    description: 'customCode CSS/JS animations: spinner, pulsing badge, bouncing price.',
    config: animatedHtmlElements as any,
  },
  {
    slug: 'zvid-ad',
    title: 'Zvid Ad',
    description: 'Product-style promo with text overlays and music.',
    config: zvidAd as any,
  },
  {
    slug: 'inspirational-video',
    title: 'Inspirational Video',
    description: 'Video background with animated quotes.',
    config: inspirationalVideo as any,
  },
  {
    slug: 'used-car-dealer-promo',
    title: 'Used Car Dealer Promo',
    description: 'Multi-element promo composition.',
    config: usedCarDealerPromo as any,
  },
  {
    slug: 'promo-golden',
    title: 'Promo Golden (scenes)',
    description: 'Scene + global overlay + audio (the package input.json).',
    config: promoGolden as any,
  },
]

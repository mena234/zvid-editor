/**
 * Display categories for the example-project browser (ExamplesModal).
 *
 * Each category maps 1:1 to a template pack — `LibraryItem.meta.pack`, produced
 * by editor/data/examples/template-packs.manifest.jsonc and published to the
 * orch content library. `keywords` widen search so an industry/topic term
 * surfaces a category even when the word isn't in a template's title or
 * description (e.g. "crypto" → Finance, "restaurant" → the food pack). The order
 * here is the order sections appear in the modal. Items whose meta.pack is
 * missing or unknown fall into the OTHER bucket so nothing is ever dropped.
 */
export interface ExampleCategory {
  /** Matches LibraryItem.meta.pack. */
  key: string
  /** Chip + section-header label. */
  label: string
  /** One-line description shown under the section header. */
  blurb: string
  /** Extra search synonyms (industry / topic terms). */
  keywords: string[]
}

export const OTHER_CATEGORY_KEY = 'other'

export const EXAMPLE_CATEGORIES: ExampleCategory[] = [
  {
    key: 'ecommerce',
    label: 'E-commerce',
    blurb: 'Product promos, sales and drops for online stores',
    keywords: [
      'ecommerce', 'e-commerce', 'shop', 'store', 'product', 'retail', 'dtc',
      'dropshipping', 'sale', 'discount', 'promo', 'checkout', 'brand',
      'online store', 'shopify',
    ],
  },
  {
    key: 'agency',
    label: 'Ad creative / agency',
    blurb: 'Ad creatives and client reports for marketing teams',
    keywords: [
      'ad', 'ads', 'advert', 'advertising', 'creative', 'marketing', 'campaign',
      'ugc', 'performance', 'roas', 'agency', 'a/b test',
    ],
  },
  {
    key: 'realty',
    label: 'Real estate',
    blurb: 'Listings, tours and sold announcements for agents',
    keywords: [
      'property', 'listing', 'home', 'house', 'apartment', 'realtor', 'realty',
      'mortgage', 'rent', 'agent', 'open house', 'estate',
    ],
  },
  {
    key: 'auto',
    label: 'Car dealer / vehicle',
    blurb: 'Vehicle listings and dealer promos',
    keywords: [
      'car', 'cars', 'vehicle', 'dealer', 'dealership', 'automotive', 'motor',
      'suv', 'ev', 'test drive', 'trade-in', 'auto',
    ],
  },
  {
    key: 'saas',
    label: 'SaaS / dev tools',
    blurb: 'Feature launches, changelogs and product demos',
    keywords: [
      'software', 'app', 'saas', 'developer', 'api', 'product', 'startup',
      'tech', 'b2b', 'changelog', 'feature', 'onboarding', 'integration',
    ],
  },
  {
    key: 'ai',
    label: 'AI startup',
    blurb: 'Model updates, demos and result showcases',
    keywords: [
      'ai', 'artificial intelligence', 'ml', 'machine learning', 'llm', 'model',
      'prompt', 'gpt', 'agent', 'genai', 'automation', 'neural',
    ],
  },
  {
    key: 'social',
    label: 'Content creator / social',
    blurb: 'Reels, tips and story formats for creators',
    keywords: [
      'creator', 'influencer', 'social', 'tiktok', 'reels', 'reel', 'instagram',
      'youtube', 'content', 'podcast', 'follower', 'thread', 'meme',
    ],
  },
  {
    key: 'news',
    label: 'News / media',
    blurb: 'Headlines and article-to-video briefs',
    keywords: [
      'news', 'rss', 'media', 'headline', 'breaking', 'journalism', 'press',
      'bulletin', 'report', 'article',
    ],
  },
  {
    key: 'finance',
    label: 'Finance / crypto',
    blurb: 'Market updates, crypto and investment explainers',
    keywords: [
      'finance', 'investment', 'invest', 'crypto', 'bitcoin', 'trading',
      'stocks', 'fintech', 'money', 'bank', 'portfolio', 'market',
    ],
  },
  {
    key: 'hr',
    label: 'HR / recruiting',
    blurb: 'Job posts, hiring and employee updates',
    keywords: [
      'hr', 'recruiting', 'recruit', 'hiring', 'jobs', 'job', 'career',
      'talent', 'employee', 'onboarding', 'workplace', 'vacancy',
    ],
  },
  {
    key: 'events',
    label: 'Events / webinars',
    blurb: 'Webinar, conference and event invites',
    keywords: [
      'event', 'events', 'webinar', 'conference', 'summit', 'meetup',
      'workshop', 'ticket', 'rsvp', 'speaker', 'agenda', 'expo',
    ],
  },
  {
    key: 'edtech',
    label: 'Education / EdTech',
    blurb: 'Lessons, quizzes and course promos',
    keywords: [
      'education', 'edtech', 'course', 'learn', 'learning', 'school',
      'tutorial', 'lesson', 'quiz', 'student', 'teach', 'exam',
    ],
  },
  {
    key: 'travel',
    label: 'Travel / tourism',
    blurb: 'Destinations, hotels and trip highlights',
    keywords: [
      'travel', 'hotel', 'tourism', 'trip', 'vacation', 'flight', 'destination',
      'booking', 'resort', 'holiday', 'tour', 'getaway',
    ],
  },
  {
    key: 'local',
    label: 'Restaurant / food',
    blurb: 'Menus, specials and restaurant promos',
    keywords: [
      'restaurant', 'food', 'cafe', 'café', 'menu', 'dish', 'dining',
      'delivery', 'chef', 'coffee', 'bar', 'eatery', 'meal',
    ],
  },
  {
    key: 'fitness',
    label: 'Fitness / wellness',
    blurb: 'Workouts, challenges and wellness tips',
    keywords: [
      'fitness', 'wellness', 'gym', 'workout', 'health', 'yoga', 'nutrition',
      'trainer', 'exercise', 'coach', 'diet', 'training',
    ],
  },
  {
    key: 'apppersonal',
    label: 'App personalization',
    blurb: 'Personalized recaps, milestones and nudges',
    keywords: [
      'app', 'personalized', 'personalization', 'retention', 'engagement',
      'notification', 'milestone', 'streak', 'wrapped', 'recap', 'reminder',
    ],
  },
  {
    key: 'dataviz',
    label: 'Data viz / reports',
    blurb: 'Charts, dashboards and report videos',
    keywords: [
      'dataviz', 'data', 'visualization', 'chart', 'graph', 'report',
      'dashboard', 'analytics', 'metrics', 'kpi', 'stats', 'infographic',
      'insights',
    ],
  },
  {
    key: 'sports',
    label: 'Sports',
    blurb: 'Match results, fixtures and team highlights',
    keywords: [
      'sports', 'sport', 'match', 'game', 'team', 'score', 'fixture', 'league',
      'athlete', 'tournament', 'player', 'result',
    ],
  },
  {
    key: 'localservice',
    label: 'Local services',
    blurb: 'Promos and bookings for local businesses',
    keywords: [
      'local service', 'plumber', 'salon', 'cleaning', 'contractor', 'repair',
      'handyman', 'appointment', 'booking', 'trades', 'service', 'electrician',
    ],
  },
  {
    key: 'marketplace',
    label: 'Marketplace / listings',
    blurb: 'Listings and seller promos for marketplaces',
    keywords: [
      'marketplace', 'classified', 'classifieds', 'listing', 'listings',
      'seller', 'buyer', 'secondhand', 'rental', 'gig', 'peer-to-peer',
    ],
  },
]

/** Catch-all for legacy/demo templates that carry no meta.pack. */
export const OTHER_CATEGORY: ExampleCategory = {
  key: OTHER_CATEGORY_KEY,
  label: 'Other',
  blurb: 'Demos and classic starter projects',
  keywords: [],
}

/** All categories in display order, OTHER last. */
export const EXAMPLE_CATEGORIES_WITH_OTHER: ExampleCategory[] = [
  ...EXAMPLE_CATEGORIES,
  OTHER_CATEGORY,
]

const CATEGORY_BY_KEY = new Map(
  EXAMPLE_CATEGORIES_WITH_OTHER.map((c) => [c.key, c])
)

/** Category key for a template pack — falls back to OTHER for unknown/missing. */
export function categoryKeyForPack(pack?: string | null): string {
  return pack && CATEGORY_BY_KEY.has(pack) && pack !== OTHER_CATEGORY_KEY
    ? pack
    : OTHER_CATEGORY_KEY
}

export function exampleCategory(key: string): ExampleCategory | undefined {
  return CATEGORY_BY_KEY.get(key)
}

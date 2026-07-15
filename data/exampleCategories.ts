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
    key: 'thumbnail',
    label: 'Video thumbnails',
    blurb: 'Cover images that match a video — YouTube, product, podcast, listing',
    keywords: [
      'thumbnail', 'thumbnails', 'cover', 'youtube', 'poster', 'clickbait',
      'hook', 'preview', 'cover image', 'video cover', 'og',
    ],
  },
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
    key: 'ogimage',
    label: 'Open Graph / blog',
    blurb: 'Link-preview and social-share cards for blogs, docs and launches',
    keywords: [
      'open graph', 'og image', 'og', 'blog', 'article', 'link preview',
      'social share', 'meta', 'docs', 'changelog', 'seo', 'twitter card',
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
  {
    key: 'hotel',
    label: 'Hotel / hospitality',
    blurb: 'Rooms, offers and guest communications for hotels',
    keywords: [
      'hotel', 'hospitality', 'resort', 'room', 'guest', 'booking', 'spa',
      'check-in', 'checkout', 'concierge', 'suite', 'stay',
    ],
  },
  {
    key: 'health',
    label: 'Healthcare / clinic',
    blurb: 'Appointments, services and clinic updates',
    keywords: [
      'healthcare', 'clinic', 'doctor', 'medical', 'patient', 'appointment',
      'dental', 'dentist', 'pharmacy', 'telehealth', 'hospital', 'checkup',
    ],
  },
  {
    key: 'beauty',
    label: 'Beauty / salon / spa',
    blurb: 'Treatments, bookings and offers for salons and spas',
    keywords: [
      'beauty', 'salon', 'spa', 'hair', 'nails', 'skincare', 'makeup',
      'stylist', 'barber', 'treatment', 'manicure', 'facial',
    ],
  },
  {
    key: 'recipe',
    label: 'Recipes / cooking',
    blurb: 'Recipe cards, ingredients and cooking tips',
    keywords: [
      'recipe', 'recipes', 'cooking', 'ingredients', 'baking', 'meal prep',
      'kitchen', 'dish', 'cuisine', 'nutrition', 'vegetarian', 'chef',
    ],
  },
  {
    key: 'language',
    label: 'Language learning',
    blurb: 'Vocabulary, grammar and daily practice cards',
    keywords: [
      'language', 'vocabulary', 'grammar', 'translation', 'word of the day',
      'phrase', 'idiom', 'pronunciation', 'bilingual', 'learn english',
    ],
  },
  {
    key: 'books',
    label: 'Books / publishing',
    blurb: 'Releases, quotes and promos for books and authors',
    keywords: [
      'book', 'books', 'author', 'publishing', 'reading', 'novel', 'ebook',
      'audiobook', 'bestseller', 'bookclub', 'library', 'literature',
    ],
  },
  {
    key: 'music',
    label: 'Music / audio',
    blurb: 'Releases, concerts and playlists for artists',
    keywords: [
      'music', 'song', 'album', 'artist', 'concert', 'playlist', 'dj',
      'festival', 'streaming', 'track', 'band', 'tour',
    ],
  },
  {
    key: 'podcast',
    label: 'Podcast',
    blurb: 'Episodes, guests and clips for shows',
    keywords: [
      'podcast', 'episode', 'guest', 'audiogram', 'show', 'listener',
      'season', 'clip', 'interview', 'host', 'subscribe',
    ],
  },
  {
    key: 'gaming',
    label: 'Gaming / esports',
    blurb: 'Streams, tournaments and player stats',
    keywords: [
      'gaming', 'game', 'esports', 'stream', 'streamer', 'tournament',
      'twitch', 'leaderboard', 'clan', 'patch', 'giveaway', 'gamer',
    ],
  },
  {
    key: 'construction',
    label: 'Construction / architecture',
    blurb: 'Projects, renovations and property development',
    keywords: [
      'construction', 'architecture', 'renovation', 'contractor', 'builder',
      'interior design', 'floor plan', 'development', 'engineering', 'remodel',
    ],
  },
  {
    key: 'legal',
    label: 'Legal / professional',
    blurb: 'Legal services, consultations and firm updates',
    keywords: [
      'legal', 'law', 'lawyer', 'attorney', 'firm', 'consultation',
      'contract', 'immigration', 'tax', 'compliance', 'notary', 'court',
    ],
  },
  {
    key: 'insurance',
    label: 'Insurance',
    blurb: 'Policies, renewals and claims communications',
    keywords: [
      'insurance', 'policy', 'coverage', 'claim', 'premium', 'renewal',
      'broker', 'insurer', 'deductible', 'quote', 'protection',
    ],
  },
  {
    key: 'logistics',
    label: 'Logistics / delivery',
    blurb: 'Shipping updates, tracking and courier promos',
    keywords: [
      'logistics', 'delivery', 'shipping', 'courier', 'tracking', 'parcel',
      'package', 'freight', 'warehouse', 'fleet', 'customs', 'shipment',
    ],
  },
  {
    key: 'industrial',
    label: 'Manufacturing / industrial',
    blurb: 'Production, quality and factory communications',
    keywords: [
      'manufacturing', 'industrial', 'factory', 'production', 'machinery',
      'quality control', 'supplier', 'plant', 'engineering', 'b2b',
    ],
  },
  {
    key: 'agriculture',
    label: 'Agriculture / farming',
    blurb: 'Crops, harvests and farm-to-market updates',
    keywords: [
      'agriculture', 'farming', 'farm', 'crop', 'harvest', 'livestock',
      'organic', 'produce', 'tractor', 'irrigation', 'agri', 'farmer',
    ],
  },
  {
    key: 'nonprofit',
    label: 'Nonprofit / charity',
    blurb: 'Appeals, impact reports and volunteer drives',
    keywords: [
      'nonprofit', 'charity', 'donation', 'fundraising', 'volunteer', 'ngo',
      'cause', 'impact', 'donor', 'campaign', 'giving', 'foundation',
    ],
  },
  {
    key: 'government',
    label: 'Government / public services',
    blurb: 'Public announcements, services and civic updates',
    keywords: [
      'government', 'public', 'municipality', 'city', 'civic', 'permit',
      'election', 'announcement', 'road closure', 'utility', 'citizen',
    ],
  },
  {
    key: 'community',
    label: 'Faith / community',
    blurb: 'Gatherings, schedules and community programs',
    keywords: [
      'community', 'religious', 'faith', 'mosque', 'church', 'prayer',
      'gathering', 'congregation', 'charity', 'youth', 'volunteer',
    ],
  },
  {
    key: 'weddings',
    label: 'Weddings / celebrations',
    blurb: 'Invitations, save-the-dates and event cards',
    keywords: [
      'wedding', 'weddings', 'celebration', 'invitation', 'save the date',
      'anniversary', 'birthday', 'baby shower', 'graduation', 'party', 'rsvp',
    ],
  },
  {
    key: 'adpromo',
    label: 'Ads & commercials',
    blurb: 'Punchy promos, funny commercials and sale ads for any business',
    keywords: [
      'commercial', 'promo', 'ad', 'ads', 'sale', 'flash sale', 'discount',
      'funny', 'retro', '80s', 'mascot', 'offer', 'advert', 'campaign',
    ],
  },
  {
    key: 'explainer',
    label: 'Explainers',
    blurb: 'Explain your business, service, app or process step by step',
    keywords: [
      'explainer', 'explain', 'how it works', 'how to', 'tutorial',
      'walkthrough', 'steps', 'character', 'mascot', 'service', 'process',
    ],
  },
  {
    key: 'infographic',
    label: 'Infographics',
    blurb: 'Animated stats, charts and data stories',
    keywords: [
      'infographic', 'infographics', 'stats', 'statistics', 'data', 'chart',
      'graph', 'numbers', 'facts', 'percent', 'animated',
    ],
  },
  {
    key: 'birthday',
    label: 'Birthdays',
    blurb: 'Birthday cards, greetings and team celebrations',
    keywords: [
      'birthday', 'bday', 'cake', 'celebration', 'greetings', 'party',
      'balloons', 'wishes', 'staff birthday', 'team birthday',
    ],
  },
  {
    key: 'welcome',
    label: 'Intros & welcomes',
    blurb: 'Introduce new hires and meet-the-team videos',
    keywords: [
      'welcome', 'intro', 'introduction', 'new hire', 'new employee',
      'meet the team', 'team', 'teammate', 'introduce', 'aboard',
    ],
  },
  {
    key: 'recruiting',
    label: 'Hiring & job ads',
    blurb: "We're-hiring posts, job ads and video resumes",
    keywords: [
      'hiring', "we're hiring", 'job', 'job ad', 'recruiting', 'recruitment',
      'vacancy', 'career', 'resume', 'cv', 'apply', 'talent', 'job offer',
    ],
  },
  {
    key: 'praise',
    label: 'Praise & thanks',
    blurb: 'Shout-outs, kudos and employee recognition',
    keywords: [
      'praise', 'thanks', 'thank you', 'kudos', 'shout-out', 'recognition',
      'great job', 'you rock', 'employee of the month', 'appreciation',
    ],
  },
  {
    key: 'updates',
    label: 'Updates & reports',
    blurb: 'Weekly updates, quarterly results and company news',
    keywords: [
      'update', 'weekly', 'monthly', 'quarterly', 'results', 'report',
      'briefing', 'newsletter', 'all-hands', 'board meeting', 'year in review',
      'status', 'company update',
    ],
  },
  {
    key: 'internalcomms',
    label: 'Internal comms & training',
    blurb: 'Announcements, policies, onboarding and training',
    keywords: [
      'internal', 'policy', 'onboarding', 'training', 'wellness',
      'mental health', 'leadership', 'mission', 'culture', 'workplace',
      'announcement', 'hybrid work',
    ],
  },
  {
    key: 'launch',
    label: 'Launches & demos',
    blurb: 'Product launches, app demos and case studies',
    keywords: [
      'launch', 'product launch', 'demo', 'product demo', 'app demo',
      'release', 'case study', 'showcase', 'reveal',
    ],
  },
  {
    key: 'occasions',
    label: 'Holidays & slideshows',
    blurb: 'Holiday cards, event slideshows and presentations',
    keywords: [
      'holiday', 'holidays', 'christmas', 'wedding invitation', 'slideshow',
      'party', 'event', 'presentation', 'end of year', 'school', 'quiz night',
      'office party',
    ],
  },
  {
    key: 'fun',
    label: 'Fun & trailers',
    blurb: 'Character fun, book trailers and movie credits',
    keywords: [
      'fun', 'funny', 'trailer', 'book trailer', 'film', 'movie', 'credits',
      'superhero', 'celebrate', 'character', 'cinematic',
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

/** Published Product Hero walkthrough. Times match the final narrated video. */
export const EDITOR_TUTORIAL = {
  videoId: 'wAAyg6-r6TM',
  title: 'Build a Product Hero',
  duration: '8:42',
  poster: '/tutorials/product-hero.jpg',
  chapters: [
    { seconds: 0, time: '0:00', title: 'Start from scratch' },
    { seconds: 36, time: '0:36', title: 'Product image & text' },
    { seconds: 84, time: '1:24', title: 'Scenes & stock video' },
    { seconds: 162, time: '2:42', title: 'Offer & call to action' },
    { seconds: 212, time: '3:32', title: 'Scene transitions' },
    { seconds: 245, time: '4:05', title: 'Music from the stock library' },
    { seconds: 275, time: '4:35', title: 'Reusable templates with variables' },
    { seconds: 403, time: '6:43', title: 'Save, export & render' },
    { seconds: 444, time: '7:24', title: 'Video examples & templates' },
    { seconds: 494, time: '8:14', title: 'Image examples & templates' },
  ],
} as const

export const EDITOR_TUTORIAL_URL = `https://www.youtube.com/watch?v=${EDITOR_TUTORIAL.videoId}`

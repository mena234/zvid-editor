<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAuthStore } from '~/stores/auth'
import { useReviewCampaignStore } from '~/stores/reviewCampaign'
import type { ReviewRewardKind } from '~/types/reviewCampaign'

const auth = useAuthStore()
const campaign = useReviewCampaignStore()
const feedback = ref('')
const publicationConsent = ref(false)
const emailOpened = ref({ g2: false, video: false })
const config = computed(() => campaign.snapshot?.config)
const title = computed(() => {
  if (campaign.view === 'feedback') return 'What could Zvid do better?'
  if (campaign.view === 'rewards') return 'Share your experience with Zvid'
  return 'How is your video generation experience so far?'
})
const g2Status = computed(() => campaign.snapshot?.state.g2Status ?? 'available')
const videoStatus = computed(() => campaign.snapshot?.state.videoStatus ?? 'available')
const g2Url = computed(() => {
  try {
    const url = new URL(config.value?.g2Url ?? '')
    return url.protocol === 'https:' && (url.hostname === 'g2.com' || url.hostname.endsWith('.g2.com')) ? url.href : ''
  } catch { return '' }
})

function mailto(kind: ReviewRewardKind) {
  const subject = kind === 'g2' ? 'Zvid G2 review credit request' : 'Zvid video testimonial credit request'
  const body = [
    `Zvid account email: ${auth.user?.email ?? ''}`,
    '',
    kind === 'g2'
      ? 'I have attached a screenshot of my published G2 review. I disclosed the credit incentive on G2.'
      : 'I have attached my video testimonial or included a link below.',
    ...(kind === 'video' ? [
      '',
      'I give Zvid permission to publish this video testimonial on its website with disclosure that I received Zvid credits.',
    ] : []),
    '',
    'Attachment or video link:',
  ].join('\n')
  return `mailto:${config.value?.contactEmail ?? 'mina@zvid.io'}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

function onEmailClick(kind: ReviewRewardKind) {
  emailOpened.value[kind] = true
  void campaign.openOffer(kind)
}
</script>

<template>
  <UiModal :title="title" width="620px" @close="campaign.close()">
    <div class="review-content" :aria-busy="campaign.busy">
      <template v-if="campaign.view === 'question'">
        <p class="intro">Would you recommend Zvid?</p>
        <p class="hint">We would love to hear what is working for you and what we can improve.</p>
        <div class="actions">
          <button class="btn primary choice" :disabled="campaign.busy" @click="campaign.answer('yes')">Yes</button>
          <button class="btn choice" :disabled="campaign.busy" @click="campaign.answer('no')">No</button>
        </div>
        <button class="text-button" :disabled="campaign.busy" @click="campaign.view = 'rewards'">See review rewards</button>
      </template>

      <template v-else-if="campaign.view === 'feedback'">
        <p class="intro">Thanks for telling us. Your feedback helps us improve.</p>
        <form class="feedback-form" @submit.prevent="campaign.saveFeedback(feedback)">
          <label for="review-campaign-feedback">Tell us about your experience</label>
          <textarea id="review-campaign-feedback" v-model="feedback" class="ctl" rows="5" maxlength="4000" required placeholder="What did you try to create, and what could have worked better?" />
          <div class="actions">
            <button class="btn primary" type="submit" :disabled="campaign.busy || !feedback.trim()">Send feedback</button>
            <button class="btn ghost" type="button" :disabled="campaign.busy" @click="campaign.view = 'rewards'">See review rewards</button>
          </div>
        </form>
        <p class="hint">Need help with a project? Visit <a href="https://zvid.io/contact" target="_blank" rel="noopener noreferrer">https://zvid.io/contact</a>.</p>
      </template>

      <template v-else-if="config">
        <p v-if="campaign.feedbackSaved" class="notice" role="status">Thank you. Your feedback has been sent to the Zvid team.</p>
        <p v-else-if="campaign.snapshot?.state.answer === 'yes'" class="intro">We are happy Zvid is working for you!</p>
        <p v-else class="intro">Thank you for sharing your experience.</p>
        <p class="hint">Choose either option or both. Each reward is available once per Zvid account, after your submission is checked.</p>

        <section class="reward-card" aria-labelledby="g2-reward-title">
          <div class="reward-heading">
            <h3 id="g2-reward-title">Review Zvid on G2</h3>
            <span class="credit-badge">{{ config.g2Credits.toLocaleString() }} credits</span>
          </div>
          <p>Write a 5-star review of Zvid on G2 with honest feedback. Disclose the credit incentive when submitting your G2 review.</p>
          <template v-if="g2Status === 'available'">
            <p>Email a screenshot of your published review and your Zvid account email to <a :href="mailto('g2')" @click="onEmailClick('g2')">{{ config.contactEmail }}</a>.</p>
            <div class="actions">
              <a v-if="g2Url" class="btn primary" :href="g2Url" target="_blank" rel="noopener noreferrer" @click="campaign.openOffer('g2')">Write a review on G2</a>
              <a class="btn" :href="mailto('g2')" @click="onEmailClick('g2')">Email my review screenshot</a>
            </div>
            <p v-if="emailOpened.g2" class="hint">Your email app opens a draft. Attach your screenshot and send the email yourself.</p>
            <button class="text-button" :disabled="campaign.busy" @click="campaign.submitClaim('g2')">I've emailed my G2 submission</button>
          </template>
          <p v-else class="notice" role="status">{{ g2Status === 'awarded' ? 'Your G2 review reward has been awarded.' : 'Your submission is marked as sent. The team will check your email before awarding credits.' }}</p>
        </section>

        <section class="reward-card" aria-labelledby="video-reward-title">
          <div class="reward-heading">
            <h3 id="video-reward-title">Record a video testimonial</h3>
            <span class="credit-badge">{{ config.videoCredits.toLocaleString() }} credits</span>
          </div>
          <p>Tell us how you use Zvid and describe your experience in your own words. Email the recording or a video link and your Zvid account email to {{ config.contactEmail }}.</p>
          <template v-if="videoStatus === 'available'">
            <label class="consent">
              <input v-model="publicationConsent" type="checkbox" />
              <span>I give Zvid permission to publish my submitted video on its website, with a disclosure that I received Zvid credits.</span>
            </label>
            <div class="actions">
              <a v-if="publicationConsent" class="btn" :href="mailto('video')" @click="onEmailClick('video')">Email my video testimonial</a>
              <button v-else class="btn" disabled>Email my video testimonial</button>
            </div>
            <p v-if="emailOpened.video" class="hint">Your email app opens a draft. Attach your video or add its link, then send the email yourself.</p>
            <button class="text-button" :disabled="campaign.busy || !publicationConsent" @click="campaign.submitClaim('video', publicationConsent)">I've emailed my video submission</button>
          </template>
          <p v-else class="notice" role="status">{{ videoStatus === 'awarded' ? 'Your video testimonial reward has been awarded.' : 'Your submission is marked as sent. The team will check your email and video before awarding credits.' }}</p>
        </section>
        <button class="text-button" :disabled="campaign.busy" @click="campaign.view = 'feedback'">Share private feedback</button>
      </template>
      <p v-if="campaign.error" class="error" role="alert">{{ campaign.error }}</p>
    </div>
    <template #footer>
      <button class="btn ghost" @click="campaign.close(true)">Don't ask again</button>
      <button class="btn" @click="campaign.close()">{{ campaign.view === 'question' ? 'Maybe later' : 'Close' }}</button>
    </template>
  </UiModal>
</template>

<style scoped>
.review-content { display: flex; flex-direction: column; gap: 14px; padding-top: 8px; }
.review-content p { margin: 0; line-height: 1.6; }
.intro { font-size: 14px; color: var(--text-0); }
.hint { color: var(--text-2); font-size: 12px; }
.review-content a { color: var(--accent); }
.review-content a.btn.primary { color: #fff; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; }
.choice { min-width: 84px; }
.text-button { width: fit-content; padding: 0; border: 0; background: none; color: var(--accent); text-decoration: underline; text-underline-offset: 3px; font: inherit; font-size: 12px; cursor: pointer; text-align: left; }
.text-button:disabled { opacity: .5; cursor: default; }
.feedback-form { display: flex; flex-direction: column; gap: 10px; font-size: 12px; }
.feedback-form textarea { width: 100%; min-height: 120px; resize: vertical; }
.reward-card { display: flex; flex-direction: column; gap: 12px; padding: 16px; border: 1px solid var(--border-1); border-radius: var(--radius-m); background: var(--bg-2); font-size: 12px; }
.reward-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
.reward-heading h3 { margin: 0; font-size: 14px; color: var(--text-0); }
.credit-badge { padding: 4px 8px; border-radius: var(--radius-s); background: var(--bg-3); color: var(--text-0); font-weight: 600; white-space: nowrap; }
.consent { display: flex; gap: 8px; align-items: flex-start; line-height: 1.6; }
.consent input { margin-top: 3px; flex-shrink: 0; }
.notice { color: var(--green); }
.error { color: var(--red); font-size: 12px; }
@media (max-width: 600px) {
  .actions .btn { min-height: 40px; height: auto; white-space: normal; text-align: center; }
  .reward-card { padding: 12px; }
  .text-button { min-height: 40px; }
}
</style>

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '../../stores/auth'
import { useEditorStore } from '../../stores/editor'
import { useReviewCampaignStore } from '../../stores/reviewCampaign'
import type { ReviewCampaignResponse } from '../../types/reviewCampaign'

function snapshot(overrides: Partial<ReviewCampaignResponse> = {}): ReviewCampaignResponse {
  return {
    campaignId: 'reviews-v1',
    eligible: true,
    canPrompt: false,
    shown: true,
    leaseToken: 'lease-1',
    state: {
      answer: null, impressions: 1, dontAskAgain: false, dismissedUntil: null,
      g2Status: 'available', videoStatus: 'available',
    },
    config: {
      g2Url: 'https://www.g2.com/products/zvid/reviews',
      contactEmail: 'mina@zvid.io', g2Credits: 3000, videoCredits: 10000,
    },
    ...overrides,
  }
}

describe('editor review campaign', () => {
  const fetch = vi.fn()
  beforeEach(() => {
    setActivePinia(createPinia())
    useAuthStore().user = { id: 1, email: 'first@example.test' }
    vi.stubGlobal('$fetch', fetch)
    fetch.mockReset()
    fetch.mockResolvedValue(snapshot())
    vi.spyOn(useEditorStore(), 'notify').mockImplementation(() => {})
  })
  afterEach(() => vi.unstubAllGlobals())

  it('uses server admission and never opens when another tab owns the prompt', async () => {
    const campaign = useReviewCampaignStore()
    fetch.mockResolvedValue(snapshot({ shown: false }))
    await campaign.show(false)
    expect(useEditorStore().modal).toBeNull()
    expect(fetch.mock.calls[0][1].body).toMatchObject({ action: 'show', manual: false, source: 'editor_output' })
  })

  it('does not restore account A after logout or a new login during the request', async () => {
    let resolve!: (response: ReviewCampaignResponse) => void
    fetch.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const campaign = useReviewCampaignStore()
    const opening = campaign.show()
    useAuthStore().user = { id: 2, email: 'second@example.test' }
    campaign.syncAccount()
    resolve(snapshot())
    await opening
    expect(useEditorStore().modal).toBeNull()
    expect(campaign.snapshot).toBeNull()
    expect(campaign.accountKey).toBe('2')
    expect(campaign.busy).toBe(false)
  })

  it('does not interrupt activity that begins while admission is pending', async () => {
    let resolve!: (response: ReviewCampaignResponse) => void
    fetch.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const campaign = useReviewCampaignStore()
    const opening = campaign.show(false)
    useEditorStore().openModal('render')
    resolve(snapshot())
    await opening
    expect(useEditorStore().modal).toBe('render')
    expect(fetch.mock.calls[1][1].body).toMatchObject({ action: 'dismiss', leaseToken: 'lease-1' })
  })

  it('keeps rewards reachable after negative feedback and preserves the saved answer', async () => {
    const campaign = useReviewCampaignStore()
    await campaign.show(true)
    fetch.mockResolvedValue(snapshot({ state: { ...snapshot().state, answer: 'no' } }))
    await campaign.answer('no')
    expect(campaign.view).toBe('feedback')
    await campaign.saveFeedback('  The rendering failed twice.  ')
    expect(campaign.view).toBe('rewards')
    expect(campaign.feedbackSaved).toBe(true)
    expect(fetch.mock.calls.at(-1)?.[1].body).toMatchObject({ action: 'feedback', feedback: 'The rendering failed twice.' })
    await campaign.close()
    await campaign.show(true)
    expect(campaign.view).toBe('rewards')
  })

  it('never records a link click as a claim and requires explicit video permission', async () => {
    const campaign = useReviewCampaignStore()
    await campaign.show(true)
    await campaign.openOffer('g2')
    expect(campaign.snapshot?.state.g2Status).toBe('available')
    expect(fetch.mock.calls.at(-1)?.[1].body.action).toBe('open_offer')
    const before = fetch.mock.calls.length
    expect(await campaign.submitClaim('video', false)).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(before)
    fetch.mockResolvedValue(snapshot({ state: { ...snapshot().state, videoStatus: 'pending' } }))
    await campaign.submitClaim('video', true)
    expect(fetch.mock.calls.at(-1)?.[1].body).toMatchObject({ action: 'submit_claim', kind: 'video', publicationConsent: true })
    expect(campaign.snapshot?.state.videoStatus).toBe('pending')
  })

  it('restores a claim made without answering the initial question', async () => {
    fetch.mockResolvedValue(snapshot({ state: { ...snapshot().state, g2Status: 'pending' } }))
    await useReviewCampaignStore().show(true)
    expect(useReviewCampaignStore().view).toBe('rewards')
  })

  it('closes even offline and suppresses automatic reminders for that session', async () => {
    const campaign = useReviewCampaignStore()
    await campaign.show(true)
    fetch.mockRejectedValue(new Error('offline'))
    await campaign.close()
    expect(useEditorStore().modal).toBeNull()
    const before = fetch.mock.calls.length
    await campaign.show(false)
    expect(fetch).toHaveBeenCalledTimes(before)
  })

  it('does not clear a newer lease when an earlier dismissal finishes late', async () => {
    const campaign = useReviewCampaignStore()
    await campaign.show(true)
    let finishDismissal!: (response: ReviewCampaignResponse) => void
    fetch.mockImplementationOnce(() => new Promise(done => { finishDismissal = done }))
    const closing = campaign.close()
    fetch.mockResolvedValue(snapshot({ leaseToken: 'lease-2' }))
    await campaign.show(true)
    expect(campaign.leaseToken).toBe('lease-2')
    finishDismissal(snapshot())
    await closing
    expect(campaign.leaseToken).toBe('lease-2')
    expect(useEditorStore().modal).toBe('reviewCampaign')
  })

  it('keeps unsaved feedback available and permits retry after a failed request', async () => {
    const campaign = useReviewCampaignStore()
    await campaign.show(true)
    campaign.view = 'feedback'
    fetch.mockRejectedValueOnce(new Error('offline'))
    expect(await campaign.saveFeedback('Please improve the subtitles.')).toBe(false)
    expect(campaign.view).toBe('feedback')
    expect(campaign.feedbackSaved).toBe(false)
    expect(campaign.busy).toBe(false)
    expect(campaign.error).toContain('try again')
    expect(await campaign.saveFeedback('Please improve the subtitles.')).toBe(true)
    expect(campaign.view).toBe('rewards')
    expect(campaign.error).toBe('')
  })

  it('rejects whitespace and oversized feedback, but accepts 4000 characters', async () => {
    const campaign = useReviewCampaignStore()
    await campaign.show(true)
    const before = fetch.mock.calls.length
    expect(await campaign.saveFeedback(' \n\t ')).toBe(false)
    expect(await campaign.saveFeedback('x'.repeat(4001))).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(before)
    expect(await campaign.saveFeedback('x'.repeat(4000))).toBe(true)
  })

  it('sends only one claim when the submission button is clicked repeatedly', async () => {
    const campaign = useReviewCampaignStore()
    await campaign.show(true)
    let resolve!: (response: ReviewCampaignResponse) => void
    fetch.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const first = campaign.submitClaim('g2')
    expect(await campaign.submitClaim('g2')).toBe(false)
    expect(await campaign.submitClaim('video', true)).toBe(false)
    expect(fetch.mock.calls.filter(call => call[1]?.body?.action === 'submit_claim')).toHaveLength(1)
    resolve(snapshot({ state: { ...snapshot().state, g2Status: 'pending' } }))
    expect(await first).toBe(true)
    expect(campaign.busy).toBe(false)
  })

  it('ignores an older link response arriving after the claim succeeds', async () => {
    const campaign = useReviewCampaignStore()
    await campaign.show(true)
    let resolve!: (response: ReviewCampaignResponse) => void
    fetch.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const opened = campaign.openOffer('g2')
    fetch.mockResolvedValueOnce(snapshot({ state: { ...snapshot().state, g2Status: 'pending' } }))
    await campaign.submitClaim('g2')
    resolve(snapshot())
    await opened
    expect(campaign.snapshot?.state.g2Status).toBe('pending')
  })

  it('closes during a pending claim without reopening when its response arrives', async () => {
    const campaign = useReviewCampaignStore()
    await campaign.show(true)
    let resolve!: (response: ReviewCampaignResponse) => void
    fetch.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const submitted = campaign.submitClaim('g2')
    await campaign.close()
    expect(useEditorStore().modal).toBeNull()
    resolve(snapshot({ state: { ...snapshot().state, g2Status: 'pending' } }))
    await submitted
    expect(useEditorStore().modal).toBeNull()
    expect(campaign.busy).toBe(false)
  })

  it('does not carry old-account errors or busy state into a new account', async () => {
    const campaign = useReviewCampaignStore()
    await campaign.show(true)
    let reject!: (error: Error) => void
    fetch.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
    const submitted = campaign.submitClaim('g2')
    useAuthStore().user = { id: 2, email: 'second@example.test' }
    campaign.syncAccount()
    await campaign.show(true)
    reject(new Error('late error from first account'))
    await submitted
    expect(campaign.accountKey).toBe('2')
    expect(campaign.error).toBe('')
    expect(campaign.busy).toBe(false)
    expect(useEditorStore().modal).toBe('reviewCampaign')
  })

  it('fails quietly without leaving a busy state and allows manual retry', async () => {
    const campaign = useReviewCampaignStore()
    fetch.mockRejectedValueOnce(new Error('timeout'))
    await campaign.show(false)
    expect(useEditorStore().modal).toBeNull()
    expect(useEditorStore().notify).not.toHaveBeenCalled()
    expect(campaign.busy).toBe(false)
    await campaign.show(true)
    expect(useEditorStore().modal).toBe('reviewCampaign')
  })

  it('reports unsaved opt-out while still closing and suppressing this session', async () => {
    const campaign = useReviewCampaignStore()
    await campaign.show(true)
    fetch.mockRejectedValueOnce(new Error('offline'))
    await campaign.close(true)
    expect(useEditorStore().modal).toBeNull()
    expect(campaign.dismissedThisSession).toBe(true)
    expect(useEditorStore().notify).toHaveBeenCalledWith(expect.stringContaining('Could not save your preference'), 'info')
  })

  it('does not prompt or call the API without a signed-in user', async () => {
    useAuthStore().user = null
    const campaign = useReviewCampaignStore()
    await campaign.show(true)
    await campaign.show(false)
    expect(fetch).not.toHaveBeenCalled()
    expect(useEditorStore().modal).toBeNull()
  })

  it('releases admission when the idle condition changes during the request', async () => {
    const campaign = useReviewCampaignStore()
    let safe = true
    let resolve!: (response: ReviewCampaignResponse) => void
    fetch.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const opening = campaign.show(false, () => safe)
    safe = false
    resolve(snapshot())
    await opening
    expect(useEditorStore().modal).toBeNull()
    expect(fetch.mock.calls.at(-1)?.[1].body).toMatchObject({ action: 'dismiss', leaseToken: 'lease-1' })
  })

  it('does not erase the new account lease when canceled admission finishes late', async () => {
    const campaign = useReviewCampaignStore()
    let safe = true
    let admit!: (response: ReviewCampaignResponse) => void
    let dismiss!: (response: ReviewCampaignResponse) => void
    fetch.mockImplementationOnce(() => new Promise(done => { admit = done }))
    fetch.mockImplementationOnce(() => new Promise(done => { dismiss = done }))
    const opening = campaign.show(false, () => safe)
    safe = false
    admit(snapshot())
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    useAuthStore().user = { id: 2, email: 'second@example.test' }
    campaign.syncAccount()
    fetch.mockResolvedValue(snapshot({ leaseToken: 'second-account-lease' }))
    await campaign.show(true)
    dismiss(snapshot())
    await opening
    expect(campaign.accountKey).toBe('2')
    expect(campaign.leaseToken).toBe('second-account-lease')
    expect(useEditorStore().modal).toBe('reviewCampaign')
  })
})

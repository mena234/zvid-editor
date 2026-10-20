export type ReviewRewardKind = 'g2' | 'video'
export type ReviewRewardStatus = 'available' | 'pending' | 'awarded'
export type ReviewCampaignView = 'question' | 'feedback' | 'rewards'

export interface ReviewCampaignSnapshot {
  campaignId: string
  eligible: boolean
  canPrompt: boolean
  state: {
    answer: 'yes' | 'no' | null
    impressions: number
    dontAskAgain: boolean
    dismissedUntil: string | null
    g2Status: ReviewRewardStatus
    videoStatus: ReviewRewardStatus
    feedbackSubmitted?: boolean
    videoPublicationConsent?: boolean
  }
  config: {
    g2Url: string
    contactEmail: string
    g2Credits: number
    videoCredits: number
  }
}

export interface ReviewCampaignResponse extends ReviewCampaignSnapshot {
  shown?: boolean
  leaseToken?: string
}

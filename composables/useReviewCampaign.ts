import { onMounted, onBeforeUnmount, watch } from 'vue'
import { useAuthStore } from '~/stores/auth'
import { useEditorStore } from '~/stores/editor'
import { useTourStore } from '~/stores/tour'
import { useReviewCampaignStore } from '~/stores/reviewCampaign'
import { createReviewPromptScheduler } from '~/utils/reviewPromptScheduler'

/** Mounted once by the shell. All trigger surfaces share this account state. */
export function useReviewCampaign() {
  const auth = useAuthStore()
  const editor = useEditorStore()
  const tour = useTourStore()
  const campaign = useReviewCampaignStore()
  let lastActivityAt = Date.now()
  let pointerHeld = false

  function isSafe() {
    if (typeof document === 'undefined') return false
    const focused = document.activeElement as HTMLElement | null
    return !!auth.user && document.visibilityState === 'visible' && document.hasFocus()
      && !editor.modal && !editor.playing && !editor.editingTextId
      && !editor.dragState && !tour.active && !pointerHeld
      && !focused?.matches('input, textarea, select, [contenteditable="true"]')
      && !document.querySelector('[role="dialog"], [aria-expanded="true"]')
      && ![...document.querySelectorAll('video, audio')].some(media => {
        const player = media as HTMLMediaElement
        return !player.paused && !player.ended && player.getClientRects().length > 0
      })
  }

  const scheduler = createReviewPromptScheduler({
    isSafe,
    show: () => campaign.show(false, () => isSafe() && Date.now() - lastActivityAt >= 5000),
  })
  const onActivity = () => {
    lastActivityAt = Date.now()
    scheduler.activity()
  }
  const onPointerDown = () => { pointerHeld = true; onActivity() }
  const onPointerUp = () => { pointerHeld = false; onActivity() }
  const onBlur = () => { pointerHeld = false; onActivity() }

  watch(() => auth.user ? String(auth.user.id ?? auth.user.email) : '', () => {
    scheduler.cancel()
    campaign.syncAccount()
    if (auth.user) void campaign.refresh()
  }, { immediate: true, flush: 'sync' })
  watch(() => campaign.outputInteraction, (count) => {
    if (count && auth.user) scheduler.queue()
  }, { flush: 'sync' })
  watch(() => editor.modal, () => {
    onActivity()
    if (editor.modal === 'reviewCampaign') scheduler.cancel()
  }, { flush: 'sync' })

  onMounted(() => {
    document.addEventListener('keydown', onActivity, true)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('pointermove', onActivity, { capture: true, passive: true })
    document.addEventListener('pointerup', onPointerUp, true)
    document.addEventListener('pointercancel', onPointerUp, true)
    document.addEventListener('wheel', onActivity, { capture: true, passive: true })
    document.addEventListener('scroll', onActivity, { capture: true, passive: true })
    document.addEventListener('visibilitychange', onActivity)
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onActivity)
  })
  onBeforeUnmount(() => {
    scheduler.cancel()
    document.removeEventListener('keydown', onActivity, true)
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('pointermove', onActivity, true)
    document.removeEventListener('pointerup', onPointerUp, true)
    document.removeEventListener('pointercancel', onPointerUp, true)
    document.removeEventListener('wheel', onActivity, true)
    document.removeEventListener('scroll', onActivity, true)
    document.removeEventListener('visibilitychange', onActivity)
    window.removeEventListener('blur', onBlur)
    window.removeEventListener('focus', onActivity)
  })
  return campaign
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createReviewPromptScheduler } from '../../utils/reviewPromptScheduler'

describe('review prompt timing', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('needs an output interaction and five idle seconds after the results close', async () => {
    let resultsOpen = true
    const show = vi.fn(async () => {})
    const scheduler = createReviewPromptScheduler({ isSafe: () => !resultsOpen, show })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(show).not.toHaveBeenCalled()
    scheduler.queue()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(show).not.toHaveBeenCalled()
    resultsOpen = false
    scheduler.activity()
    await vi.advanceTimersByTimeAsync(4500)
    expect(show).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(500)
    expect(show).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(show).toHaveBeenCalledTimes(1)
  })

  it('postpones a queued invitation while editing, playing, or away', async () => {
    let safe = true
    const show = vi.fn(async () => {})
    const scheduler = createReviewPromptScheduler({ isSafe: () => safe, show })
    scheduler.queue()
    await vi.advanceTimersByTimeAsync(4000)
    scheduler.activity()
    await vi.advanceTimersByTimeAsync(4000)
    expect(show).not.toHaveBeenCalled()
    safe = false
    await vi.advanceTimersByTimeAsync(10_000)
    expect(show).not.toHaveBeenCalled()
    safe = true
    scheduler.activity()
    await vi.advanceTimersByTimeAsync(5000)
    expect(show).toHaveBeenCalledTimes(1)
  })

  it('cancels on logout/unmount and expires old opportunities', async () => {
    const show = vi.fn(async () => {})
    const scheduler = createReviewPromptScheduler({ isSafe: () => false, show })
    scheduler.queue()
    scheduler.cancel()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(show).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    scheduler.queue()
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(show).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('coalesces repeated output interactions into one fresh idle period', async () => {
    const show = vi.fn(async () => {})
    const scheduler = createReviewPromptScheduler({ isSafe: () => true, show })
    scheduler.queue()
    await vi.advanceTimersByTimeAsync(4000)
    scheduler.queue()
    await vi.advanceTimersByTimeAsync(4999)
    expect(show).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(show).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('never shows an expired opportunity when the editor finally becomes idle', async () => {
    let safe = false
    const show = vi.fn(async () => {})
    const scheduler = createReviewPromptScheduler({ isSafe: () => safe, show })
    scheduler.queue()
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    safe = true
    scheduler.activity()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(show).not.toHaveBeenCalled()
    scheduler.queue()
    await vi.advanceTimersByTimeAsync(5000)
    expect(show).toHaveBeenCalledTimes(1)
  })
})

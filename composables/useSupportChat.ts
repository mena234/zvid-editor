import { onBeforeUnmount, ref, watch } from 'vue'
import { useEditorStore } from '~/stores/editor'

interface SupportChatApi {
  autoStart?: boolean
  customStyle?: { zIndex: number }
  start?: () => void
  showWidget?: () => void
  hideWidget?: () => void
  maximize?: () => void
  onBeforeLoad?: () => void
  onLoad?: () => void
  onChatMaximized?: () => void
  onChatMinimized?: () => void
  onChatHidden?: () => void
}

/** Load support only when requested. The editor's dialogs always take priority.
 * API lifecycle: https://developer.tawk.to/jsapi/ */
export function useSupportChat() {
  const editor = useEditorStore()
  const loading = ref(false)
  const error = ref(false)
  let api: SupportChatApi | undefined
  let script: HTMLScriptElement | undefined
  let ready = false
  let visible = false
  let disposed = false
  let pending: Promise<boolean> | undefined
  let finish: ((ok: boolean) => void) | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined

  function hide() {
    visible = false
    api?.hideWidget?.()
  }

  function show() {
    if (!ready || disposed || editor.modal) return
    visible = true
    api?.start?.()
    api?.showWidget?.()
    api?.maximize?.()
  }

  function load(): Promise<boolean> {
    if (ready) return Promise.resolve(true)
    if (pending) return pending
    loading.value = true
    error.value = false
    pending = new Promise(resolve => {
      finish = ok => {
        clearTimeout(timeout)
        loading.value = false
        error.value = !ok && !disposed
        pending = undefined
        finish = undefined
        resolve(ok)
      }
      // A blocked or slow provider must still leave contact support available.
      timeout = setTimeout(() => finish?.(false), 15_000)
    })
    if (!script) {
      const chatWindow = window as Window & { Tawk_API?: SupportChatApi; Tawk_LoadStart?: Date }
      api = chatWindow.Tawk_API = chatWindow.Tawk_API ?? {}
      // Both options must be set before the embed script is downloaded.
      api.autoStart = false
      api.customStyle = { zIndex: 90 }
      api.onBeforeLoad = () => { if (!disposed) api?.start?.() }
      api.onLoad = () => {
        ready = true
        hide()
        finish?.(!disposed)
      }
      api.onChatMaximized = () => {
        if (!visible || editor.modal || disposed) hide()
      }
      api.onChatMinimized = hide
      api.onChatHidden = () => { visible = false }
      chatWindow.Tawk_LoadStart = new Date()
      script = document.createElement('script')
      script.async = true
      script.src = 'https://embed.tawk.to/6a54e8f61df89a1d45ebaa2a/1jtdqs1ga'
      script.charset = 'UTF-8'
      script.crossOrigin = 'anonymous'
      script.onerror = () => {
        script?.remove()
        script = undefined
        finish?.(false)
      }
      document.head.appendChild(script)
    }
    return pending!
  }

  watch(() => editor.modal, modal => { if (modal) hide() }, { flush: 'sync' })
  onBeforeUnmount(() => {
    disposed = true
    hide()
    finish?.(false)
  })

  return { loading, error, load, show, hide }
}

import { useProjectStore } from '~/stores/project'
import { useEditorStore } from '~/stores/editor'
import { useAuthStore } from '~/stores/auth'
import { useStockStore } from '~/stores/stock'
import { useUploadsStore } from '~/stores/uploads'
import { useDesignsStore } from '~/stores/designs'
import { useTourStore } from '~/stores/tour'
import {
  importProject,
  exportProject,
  exportProjectString,
} from '~/shared/schema/normalize'
import { validateProjectDoc } from '~/shared/schema/validate'

/**
 * Automation/test bridge (window.__zvidTest) for the E2E suite and fidelity
 * harnesses — the deterministic hook EDITOR_VIDEO_PARITY_ISSUES.md asked for.
 *
 * Enabled in dev servers always, and in production builds only when
 * localStorage['zvid-test-hooks'] is set (Puppeteer sets it via
 * evaluateOnNewDocument before any app script runs). Never enabled for
 * ordinary users.
 */
export default defineNuxtPlugin((nuxtApp) => {
  let enabled = import.meta.dev
  if (!enabled) {
    try {
      enabled = !!localStorage.getItem('zvid-test-hooks')
    } catch {
      enabled = false
    }
  }
  if (!enabled) return

  const pinia = nuxtApp.$pinia as any

  ;(window as any).__zvidTest = {
    get project() {
      return useProjectStore(pinia)
    },
    get editor() {
      return useEditorStore(pinia)
    },
    get auth() {
      return useAuthStore(pinia)
    },
    get stock() {
      return useStockStore(pinia)
    },
    get uploads() {
      return useUploadsStore(pinia)
    },
    get designs() {
      return useDesignsStore(pinia)
    },
    get tour() {
      return useTourStore(pinia)
    },
    /** Exported (minimal, render-ready) JSON of the current document. */
    exportedDoc() {
      return JSON.parse(exportProjectString(useProjectStore(pinia).doc))
    },
    /** Validation issues for the current document. */
    validate() {
      return validateProjectDoc(useProjectStore(pinia).doc)
    },
    /** Replace the current document from raw project JSON (like Import). */
    loadRaw(raw: any) {
      const store = useProjectStore(pinia)
      store.loadRaw(raw)
      return store.importWarnings
    },
    exportProject,
    importProject,
  }
})

import { useAuthStore } from '~/stores/auth'
import { useEditorStore } from '~/stores/editor'
import { useProjectStore } from '~/stores/project'

/**
 * Boot-time session fetch (fire and forget — the editor is fully usable
 * logged out) + cloud-link hygiene: replacing the document via New/Import/
 * Examples must unlink it from any cloud project, or the next Save would
 * overwrite an unrelated saved project.
 */
const CLOUD_LINK_KEY = 'zvid-cloud-project'

export default defineNuxtPlugin(() => {
  const auth = useAuthStore()
  const editor = useEditorStore()
  const project = useProjectStore()

  auth.fetchSession()

  // The document survives reloads via the project store's localStorage
  // autosave — the cloud link must survive with it, or the next Save after
  // a reload would fork a duplicate instead of updating the saved project.
  try {
    const raw = localStorage.getItem(CLOUD_LINK_KEY)
    if (raw) {
      const link = JSON.parse(raw)
      if (
        link &&
        typeof link.id === 'string' &&
        typeof link.name === 'string'
      ) {
        editor.setCloudProject(link)
      }
    }
  } catch {
    /* corrupt entry — start unlinked */
  }

  watch(
    () => editor.cloudProject,
    (link) => {
      try {
        if (link) localStorage.setItem(CLOUD_LINK_KEY, JSON.stringify(link))
        else localStorage.removeItem(CLOUD_LINK_KEY)
      } catch {
        /* storage full/unavailable — link just won't survive reloads */
      }
    }
  )

  project.$onAction(({ name, after }) => {
    if (name === 'newProject' || name === 'loadRaw') {
      after(() => editor.setCloudProject(null))
    }
  })
})

import { watch } from 'vue'
import { useAuthStore } from '~/stores/auth'
import { useEditorStore } from '~/stores/editor'
import { useProjectStore } from '~/stores/project'
import type { ModalKind } from '~/stores/editor'

export interface CloudProjectRow {
  id: string
  name: string
  version: number
  createdAt: string
  updatedAt: string
}

export interface CloudFailure {
  success: false
  status: number
  error: string
  details?: { field: string; message: string }[] | null
}

/**
 * Cloud save actions shared by the TopBar and the account menu. The editor
 * itself never requires an account — these helpers gate only the save
 * paths, opening the sign-in modal and remembering which modal to reopen
 * after a successful login.
 */
export function useCloud() {
  const auth = useAuthStore()
  const editor = useEditorStore()
  const project = useProjectStore()

  /** True if signed in; otherwise opens the auth modal and remembers intent. */
  function requireAuth(intent: Exclude<ModalKind, null>): boolean {
    if (auth.user) return true
    editor.postAuthModal = intent
    editor.openModal('auth')
    return false
  }

  /** The exact JSON `zvid render` accepts — same output as Export. */
  function currentPayload(): Record<string, any> {
    return project.exportRaw()
  }

  /**
   * Shared handling for expired sessions on any cloud envelope failure.
   * Returns true when the failure was consumed (auth modal opened).
   */
  function handleExpired(
    r: CloudFailure,
    reopen: Exclude<ModalKind, null> | null
  ): boolean {
    if (r.status !== 401) return false
    auth.sessionExpired()
    editor.postAuthModal = reopen
    editor.openModal('auth')
    editor.notify('Your session expired — please sign in again', 'info')
    return true
  }

  /**
   * TopBar "Save": update the linked cloud project in place, or ask for a
   * name first (new cloud project) when the document isn't linked yet.
   */
  async function saveToCloud() {
    if (!requireAuth('saveProject')) return
    const link = editor.cloudProject
    if (!link) {
      editor.openModal('saveProject')
      return
    }

    const name = (project.doc.name || '').trim() || link.name
    try {
      const r = await $fetch<any>(`/api/projects/${link.id}`, {
        method: 'PUT',
        body: { name, payload: currentPayload() },
      })
      if (r.success) {
        editor.setCloudProject({ id: r.project.id, name: r.project.name })
        editor.notify('Saved to your account', 'success')
      } else if (r.status === 404) {
        // Deleted elsewhere — fall back to saving as a new project.
        editor.setCloudProject(null)
        editor.openModal('saveProject')
      } else if (!handleExpired(r, 'saveProject')) {
        editor.notify(r.error || 'Save failed', 'error')
      }
    } catch {
      editor.notify('Save failed — is the editor server running?', 'error')
    }
  }

  /**
   * Dashboard deep links: /?project=prj_… opens a cloud project,
   * /?template=tpl_… loads a template's JSON as the working document.
   * Called once at boot AFTER the autosave restore so the link wins; the
   * query is stripped afterwards so a manual reload keeps local edits.
   */
  async function openFromQuery() {
    const params = new URLSearchParams(window.location.search)
    const projectId = params.get('project')
    const templateId = params.get('template')
    if (!projectId && !templateId) return

    const strip = () => {
      const url = new URL(window.location.href)
      url.searchParams.delete('project')
      url.searchParams.delete('template')
      history.replaceState(
        history.state,
        '',
        url.pathname + url.search + url.hash
      )
    }

    // The boot plugin fires the session fetch; wait for it to settle.
    if (!auth.loaded) {
      await new Promise<void>((resolve) => {
        const stop = watch(
          () => auth.loaded,
          (loaded) => {
            if (loaded) {
              stop()
              resolve()
            }
          }
        )
      })
    }

    if (!auth.user) {
      editor.postAuthModal = null
      editor.openModal('auth')
      editor.notify('Sign in to open this link', 'info')
      const stop = watch(
        () => auth.user,
        (user) => {
          if (user) {
            stop()
            openFromQuery()
          }
        }
      )
      return
    }

    try {
      if (projectId) {
        const r = await $fetch<any>(
          `/api/projects/${encodeURIComponent(projectId)}`
        )
        if (r.success) {
          project.loadRaw(r.project.payload)
          editor.setCloudProject({ id: r.project.id, name: r.project.name })
          editor.setContext('root')
          editor.clearSelection()
          editor.notify(`Opened “${r.project.name}”`, 'success')
        } else if (!handleExpired(r, null)) {
          editor.notify(r.error || 'Could not open the project', 'error')
        }
      } else if (templateId) {
        const r = await $fetch<any>(
          `/api/templates/${encodeURIComponent(templateId)}`
        )
        if (r.success) {
          project.loadRaw(r.template.project)
          editor.setContext('root')
          editor.clearSelection()
          editor.notify(
            `Loaded template “${r.template.name}” — use Save as template to publish changes`,
            'success'
          )
        } else if (!handleExpired(r, null)) {
          editor.notify(r.error || 'Could not load the template', 'error')
        }
      }
    } catch {
      editor.notify('Could not open the link — try again.', 'error')
    }
    strip()
  }

  function openProjects() {
    if (requireAuth('projects')) editor.openModal('projects')
  }

  function openSaveTemplate() {
    if (requireAuth('saveTemplate')) editor.openModal('saveTemplate')
  }

  return {
    requireAuth,
    currentPayload,
    handleExpired,
    saveToCloud,
    openFromQuery,
    openProjects,
    openSaveTemplate,
  }
}

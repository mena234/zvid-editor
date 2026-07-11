import { watch } from 'vue'
import { useAuthStore } from '~/stores/auth'
import { useEditorStore } from '~/stores/editor'
import { useProjectStore } from '~/stores/project'
import type { ModalKind } from '~/stores/editor'
import {
  fetchLibraryContent,
  fetchLibraryList,
  libraryErrorMessage,
} from '~/composables/useLibrary'

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
 * Hosts the public `?exampleUrl=` deep link may fetch a render payload from:
 * the content CDN (production) plus loopback (dev + tests). Anything else is
 * rejected so a crafted link can't make the editor load JSON from a hostile
 * origin. Returns the normalized URL when trusted, otherwise null.
 */
const TRUSTED_EXAMPLE_HOSTS = new Set([
  'cdn.zvid.io',
  'localhost',
  '127.0.0.1',
  '[::1]',
])

export function trustedExampleUrl(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  return TRUSTED_EXAMPLE_HOSTS.has(url.hostname) ? url.href : null
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
   * Public deep link (marketing site "Open in editor"): fetch a curated
   * example's render payload straight from the content CDN and load it as a
   * fresh, unsaved document. No account required — mirrors ExamplesModal's
   * load path. The URL is host-checked first (see trustedExampleUrl).
   */
  async function openExampleFromUrl(rawUrl: string): Promise<void> {
    const href = trustedExampleUrl(rawUrl)
    if (!href) {
      editor.notify('That example link is not from a trusted source', 'error')
      return
    }
    try {
      const config = await $fetch(href, { responseType: 'json' })
      project.loadRaw(config)
      editor.setCloudProject(null)
      editor.setContext('root')
      editor.clearSelection()
      editor.notify('Example loaded — start editing', 'success')
    } catch {
      editor.notify('Could not open that example — try again.', 'error')
    }
  }

  /**
   * Dashboard deep links: /?project=prj_… opens a cloud project,
   * /?template=tpl_… loads a template's JSON as the working document.
   * /?exampleUrl=… loads a curated example from the CDN (public, see above).
   * Called once at boot AFTER the autosave restore so the link wins; the
   * query is stripped afterwards so a manual reload keeps local edits.
   */
  async function openFromQuery() {
    const params = new URLSearchParams(window.location.search)
    const projectId = params.get('project')
    const templateId = params.get('template')
    const exampleSlug = params.get('example')
    const exampleUrl = params.get('exampleUrl')
    if (!projectId && !templateId && !exampleSlug && !exampleUrl) return

    const strip = () => {
      const url = new URL(window.location.href)
      url.searchParams.delete('project')
      url.searchParams.delete('template')
      url.searchParams.delete('example')
      url.searchParams.delete('exampleUrl')
      history.replaceState(
        history.state,
        '',
        url.pathname + url.search + url.hash
      )
    }

    // Public "Open in editor" link from the marketing site: load a curated
    // example straight from the content CDN. No account required, so it runs
    // ahead of the auth gate below.
    if (exampleUrl && !projectId && !templateId && !exampleSlug) {
      await openExampleFromUrl(exampleUrl)
      strip()
      return
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
      } else if (exampleSlug) {
        // Admin deep link from the dash Examples page: edit + republish.
        await openExampleForEditing(exampleSlug)
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

  /* ---------------- admin: edit + republish library examples ------------- */

  /** True when the session belongs to an admin (gates the example-edit flow). */
  function isAdmin(): boolean {
    return !!auth.user?.isAdmin
  }

  /**
   * Admin-only: load a library example's content into the editor and remember
   * its slug so the Publish flow can re-render + republish that exact row. The
   * orch /content route lets admins fetch even premium examples.
   */
  async function openExampleForEditing(slug: string): Promise<boolean> {
    if (!auth.user) {
      editor.postAuthModal = null
      editor.openModal('auth')
      editor.notify('Sign in as an admin to edit examples', 'info')
      return false
    }
    if (!isAdmin()) {
      editor.notify('Editing examples requires an admin account', 'error')
      return false
    }
    try {
      const list = await fetchLibraryList('examples')
      const item = list.find((i) => i.slug === slug)
      if (!item) {
        editor.notify(`Example “${slug}” was not found`, 'error')
        return false
      }
      const content = await fetchLibraryContent('examples', slug)
      project.loadRaw(content)
      editor.setCloudProject(null)
      editor.setSourceExample({ slug, title: item.title, meta: item.meta })
      editor.setContext('root')
      editor.clearSelection()
      editor.notify(
        `Editing example “${item.title}” — Publish to re-render it`,
        'success'
      )
      return true
    } catch (e) {
      editor.notify(libraryErrorMessage(e), 'error')
      return false
    }
  }

  /** Open the Publish-example modal (re-render + republish the current row). */
  function publishExample() {
    if (!editor.sourceExample) return
    if (!isAdmin()) {
      editor.notify('Publishing examples requires an admin account', 'error')
      return
    }
    editor.openModal('publishExample')
  }

  return {
    requireAuth,
    currentPayload,
    handleExpired,
    saveToCloud,
    openFromQuery,
    openExampleFromUrl,
    openProjects,
    openSaveTemplate,
    isAdmin,
    openExampleForEditing,
    publishExample,
  }
}

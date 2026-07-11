<script setup lang="ts">
import { onMounted, computed, watch } from 'vue'
import { useEditorContext } from '~/composables/useEditorContext'
import { usePlayheadJumps } from '~/composables/usePlayheadJumps'
import { usePlayback } from '~/composables/usePlayback'
import { useCloud } from '~/composables/useCloud'

const { project, editor, contextDuration } = useEditorContext()
const { jumpBack, jumpForward } = usePlayheadJumps()
const cloud = useCloud()

usePlayback(() => contextDuration.value)

const isImage = computed(() => project.isImage)

// entering image mode (new project / deep link / import) freezes the clock —
// the stage shows the always-on composition at t=0
watch(isImage, (on) => {
  if (on) {
    editor.playing = false
    editor.playhead = 0
  }
})

onMounted(() => {
  editor.initTheme()
  // ?type=image|video starts a fresh project in that mode (dash "Create
  // image" CTA); ?project=/?template= links infer mode from the payload.
  const params = new URLSearchParams(window.location.search)
  const qType = params.get('type')
  if ((qType === 'image' || qType === 'video') && !params.get('project') && !params.get('template')) {
    project.newProject(qType)
    const url = new URL(window.location.href)
    url.searchParams.delete('type')
    history.replaceState(history.state, '', url.pathname + url.search + url.hash)
  } else if (!project.loadAutosave()) {
    project.newProject()
  }
  // Dashboard deep links (?project= / ?template=) override the restored doc.
  cloud.openFromQuery()
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('beforeunload', () => project.autosaveNow())
})

function isTypingTarget(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    el.isContentEditable
  )
}

function onKeyDown(e: KeyboardEvent) {
  const mod = e.ctrlKey || e.metaKey

  // while typing in a field, Ctrl+Z/Y must stay the field's own history —
  // the browser handles it natively, so no global shortcut may run here
  if (isTypingTarget(e)) return

  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault()
    if (e.shiftKey) project.redo()
    else project.undo()
    return
  }
  if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault()
    project.redo()
    return
  }
  if (editor.modal) {
    if (e.key === 'Escape') editor.closeModal()
    return
  }

  const fps = project.defaults.frameRate
  const frame = 1 / fps

  // arrows nudge the selected visual; otherwise they step the playhead
  const nudge = (dx: number, dy: number): boolean => {
    if (editor.selectionKind !== 'visual') return false
    const ids = editor.selectedIds.length ? editor.selectedIds : [editor.selectedId!]
    const step = e.shiftKey ? 10 : 1
    for (const id of ids) {
      const v = id && project.visualById(id)
      if (!v) continue
      project.patchVisual(
        id,
        {
          x: (v.x ?? 0) + dx * step,
          y: (v.y ?? 0) + dy * step,
          position: v.position && v.position !== 'custom' ? 'custom' : undefined,
          anchor: v.anchor ?? (v.position && v.position !== 'custom' ? v.position : undefined),
        },
        false
      )
    }
    project.commit()
    return true
  }

  switch (e.key) {
    case ' ':
      e.preventDefault()
      if (!isImage.value) editor.togglePlay()
      break
    case 'ArrowLeft':
      e.preventDefault()
      if (!nudge(-1, 0) && !isImage.value)
        editor.seek(editor.playhead - (e.shiftKey ? 1 : frame), contextDuration.value)
      break
    case 'ArrowRight':
      e.preventDefault()
      if (!nudge(1, 0) && !isImage.value)
        editor.seek(editor.playhead + (e.shiftKey ? 1 : frame), contextDuration.value)
      break
    case 'ArrowUp':
      if (nudge(0, -1)) e.preventDefault()
      break
    case 'ArrowDown':
      if (nudge(0, 1)) e.preventDefault()
      break
    case 'Home':
      jumpBack()
      break
    case 'End':
      jumpForward()
      break
    case 'Delete':
    case 'Backspace':
      if (editor.selectionKind === 'visual') {
        const ids = editor.selectedIds.length ? editor.selectedIds : [editor.selectedId!]
        ids.forEach((id) => id && project.removeVisual(id))
        editor.clearSelection()
      } else if (editor.selectionKind === 'audio' && editor.selectedId) {
        project.removeAudio(editor.selectedId)
        editor.clearSelection()
      }
      break
    case 's':
    case 'S':
      if (!mod && !isImage.value) {
        if (editor.selectionKind === 'visual' && editor.selectedId)
          project.splitVisualAt(editor.selectedId, editor.playhead)
        else if (editor.selectionKind === 'audio' && editor.selectedId)
          project.splitAudioAt(editor.selectedId, editor.playhead)
      }
      break
    case 'd':
    case 'D':
      if (mod) {
        e.preventDefault()
        if (editor.selectionKind === 'visual' && editor.selectedId) {
          const copy = project.duplicateVisual(editor.selectedId)
          if (copy) editor.selectVisual(copy._id)
        } else if (editor.selectionKind === 'audio' && editor.selectedId) {
          const copy = project.duplicateAudio(editor.selectedId)
          if (copy) editor.selectAudio(copy._id)
        }
      }
      break
    case 'm':
    case 'M':
      editor.muted = !editor.muted
      break
    case 'l':
    case 'L':
      editor.loop = !editor.loop
      break
    case '?':
      editor.openModal('shortcuts')
      break
    case 'Escape':
      editor.clearSelection()
      break
    case '=':
    case '+':
      if (mod) {
        e.preventDefault()
        editor.setZoom(editor.pxPerSec * 1.3)
      }
      break
    case '-':
      if (mod) {
        e.preventDefault()
        editor.setZoom(editor.pxPerSec / 1.3)
      }
      break
  }
}

const toastIcon = computed(() =>
  editor.toast?.kind === 'error' ? '⚠' : editor.toast?.kind === 'success' ? '✓' : 'ℹ'
)
</script>

<template>
  <div class="shell">
    <TopBar />
    <AdminExampleBanner />
    <div class="shell-main">
      <LeftRail />
      <div class="stage-col">
        <StageView data-tour="stage" />
        <!-- image mode: no timeline — the stage takes the full height -->
        <TimelinePanel v-if="!isImage" data-tour="timeline" />
      </div>
    </div>
    <AudioEngine v-if="!isImage" />

    <ModalsExportModal v-if="editor.modal === 'export'" />
    <ModalsImportModal v-if="editor.modal === 'import'" />
    <ModalsExamplesModal v-if="editor.modal === 'examples'" />
    <ModalsShortcutsModal v-if="editor.modal === 'shortcuts'" />
    <ModalsRenderModal v-if="editor.modal === 'render'" />
    <ModalsDesignerModal v-if="editor.modal === 'designer'" />
    <ModalsAuthModal v-if="editor.modal === 'auth'" />
    <ModalsSaveProjectModal v-if="editor.modal === 'saveProject'" />
    <ModalsProjectsModal v-if="editor.modal === 'projects'" />
    <ModalsSaveTemplateModal v-if="editor.modal === 'saveTemplate'" />
    <ModalsPublishExampleModal v-if="editor.modal === 'publishExample'" />

    <ProductTour />

    <Transition name="fade">
      <div v-if="editor.toast" class="toast" :class="editor.toast.kind">
        <span class="toast-icon">{{ toastIcon }}</span>
        {{ editor.toast.message }}
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  min-width: 1080px;
  background: var(--bg-0);
}
.shell-main {
  flex: 1;
  display: flex;
  min-height: 0;
}
/* stage + timeline stack to the right of the full-height sidebar */
.stage-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.toast {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 16px;
  border-radius: var(--radius-m);
  background: var(--bg-3);
  border: 1px solid var(--border-2);
  box-shadow: var(--shadow-2);
  font-size: 12.5px;
  z-index: 200;
  max-width: 60vw;
}
.toast.error {
  border-color: var(--red);
}
.toast.success {
  border-color: var(--green);
}
.toast-icon {
  font-size: 13px;
}
.toast.error .toast-icon {
  color: var(--red);
}
.toast.success .toast-icon {
  color: var(--green);
}
</style>

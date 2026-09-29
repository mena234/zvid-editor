import { nextTick } from 'vue'
import { useEditorStore } from '~/stores/editor'
import { useTourStore } from '~/stores/tour'

export function useEditorTutorial() {
  const editor = useEditorStore()
  const tour = useTourStore()

  async function openTutorial() {
    editor.playing = false
    if (tour.active) tour.finish()
    // The welcome/Help trigger may disappear. Give the modal a stable return target.
    await nextTick()
    document.querySelector<HTMLButtonElement>('[data-tutorial-trigger]')?.focus()
    editor.openModal('tutorial')
  }

  return { openTutorial }
}

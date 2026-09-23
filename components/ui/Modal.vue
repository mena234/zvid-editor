<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

defineProps<{ title: string; width?: string }>()
const emit = defineEmits<{ close: [] }>()
const modalEl = ref<HTMLElement>()
// Capture before native autofocus or child mounting can move the focus.
const returnFocus = typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
  ? document.activeElement : null
const returnFocusAncestors: string[] = []
for (let parent = returnFocus?.parentElement; parent; parent = parent.parentElement) {
  if (parent.id) returnFocusAncestors.push(parent.id)
}
let lastFocus: HTMLElement | null = null

/** Popovers such as font/variable pickers teleport beside the modal. Their
 * trigger's aria-controls keeps those dialogs in this modal's focus scope. */
function focusRoots(): HTMLElement[] {
  const modal = modalEl.value
  if (!modal) return []
  const roots = [modal]
  for (const root of roots) {
    for (const trigger of root.querySelectorAll<HTMLElement>('[aria-controls]')) {
      for (const id of (trigger.getAttribute('aria-controls') ?? '').split(/\s+/)) {
        const controlled = document.getElementById(id)
        if (controlled && !roots.some(owner => owner.contains(controlled))) roots.push(controlled)
      }
    }
  }
  return roots
}

function focusableElements(): HTMLElement[] {
  return focusRoots().flatMap(root => [...root.querySelectorAll<HTMLElement>(
    'button, a[href], input, select, textarea, [tabindex], [contenteditable="true"]'
  )]).filter(el => el.tabIndex >= 0 && !el.matches(':disabled') && !el.closest('[inert]')
    && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden')
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Tab') return
  const controls = focusableElements()
  event.preventDefault()
  if (!controls.length) return modalEl.value?.focus({ preventScroll: true })
  const index = controls.indexOf(document.activeElement as HTMLElement)
  const next = index < 0
    ? event.shiftKey ? controls.length - 1 : 0
    : (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length
  controls[next].focus()
}

function onFocusIn(event: FocusEvent) {
  const target = event.target as HTMLElement
  if (focusRoots().some(root => root.contains(target))) {
    lastFocus = target
    return
  }
  const fallback = lastFocus?.isConnected ? lastFocus : focusableElements()[0] ?? modalEl.value
  fallback?.focus({ preventScroll: true })
}

function onModalKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement
  // WebKit treats Backspace outside an editable control as browser Back.
  // Keep that navigation inside the dialog without changing field editing or
  // a child's own handler (such as Design Studio deleting its selected layer).
  if (event.key === 'Backspace' && !target.isContentEditable && !target.closest('input, textarea, select')) {
    event.preventDefault()
  }
  if (event.key !== 'Escape' || event.defaultPrevented) return
  event.stopPropagation()
  event.preventDefault()
  emit('close')
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown, true)
  document.addEventListener('focusin', onFocusIn)
  // Honor explicit form autofocus. Otherwise start in the header so Design
  // Studio opens on its canvas without raising the virtual keyboard.
  ;(modalEl.value?.querySelector<HTMLElement>('[autofocus]') ?? focusableElements()[0] ?? modalEl.value)
    ?.focus({ preventScroll: true })
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown, true)
  document.removeEventListener('focusin', onFocusIn)
  if (returnFocus?.isConnected && returnFocus.getClientRects().length) {
    returnFocus.focus({ preventScroll: true })
  } else {
    // Compact menus close while opening a modal. Restore their visible toggle
    // rather than attempting to focus the now-hidden action inside the menu.
    const triggers = [...document.querySelectorAll<HTMLElement>('[aria-controls]')].filter(el =>
      el.getClientRects().length && (el.getAttribute('aria-controls') ?? '').split(/\s+/)
        .some(id => returnFocusAncestors.includes(id)))
    ;(triggers.find(el => el.getAttribute('aria-pressed') === 'true') ?? triggers[0])
      ?.focus({ preventScroll: true })
  }
})
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop" @mousedown.self="emit('close')">
      <div ref="modalEl" class="modal" role="dialog" aria-modal="true" :aria-label="title" tabindex="-1" :style="{ width: width ?? '640px' }" @keydown.stop="onModalKeydown">
        <header class="modal-head">
          <h2>{{ title }}</h2>
          <button class="icon-btn" aria-label="Close" @click="emit('close')">
            <UiIcon name="close" />
          </button>
        </header>
        <div class="modal-body">
          <slot />
        </div>
        <footer v-if="$slots.footer" class="modal-foot">
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: var(--scrim);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  backdrop-filter: blur(3px);
  padding: 24px;
}
.modal {
  min-width: 0;
  max-width: 100%;
  max-height: calc(100vh - 64px);
  max-height: calc(100dvh - 64px);
  display: flex;
  flex-direction: column;
  background: var(--bg-1);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-l);
  box-shadow: var(--shadow-2);
  overflow: hidden;
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px 10px;
  flex: 0 0 auto;
}
.modal-head h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  min-width: 0;
  overflow-wrap: anywhere;
}
.modal-body {
  padding: 4px 18px 18px;
  overflow: auto;
  min-height: 0;
  min-width: 0;
  overscroll-behavior: contain;
  overflow-wrap: anywhere;
}
.modal-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--border-0);
  background: var(--bg-2);
  flex: 0 0 auto;
}
.modal-foot :slotted(.btn) {
  max-width: 100%;
  height: auto;
  min-height: 30px;
  padding-block: 6px;
  white-space: nowrap;
}
@media (pointer: coarse) {
  /* Include landscape phones, tablets and controls without the .ctl class. */
  .modal :deep(input:not([type='color']):not([type='range']):not([type='checkbox']):not([type='radio'])),
  .modal :deep(textarea),
  .modal :deep(select) {
    font-size: 16px;
  }
}
@media (max-width: 600px) {
  .modal-backdrop {
    padding: max(8px, env(safe-area-inset-top)) max(8px, env(safe-area-inset-right))
      max(8px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left));
  }
  .modal {
    max-height: 100%;
  }
  .modal-head {
    padding: 10px 12px 8px;
  }
  .modal-head .icon-btn {
    width: 40px;
    height: 40px;
  }
  .modal-body {
    padding: 4px 12px 14px;
  }
  .modal-foot {
    padding: 10px 12px;
  }
  .modal-foot :slotted(.hint) {
    flex-basis: 100%;
    margin: 0;
  }
  .modal-foot :slotted(.btn) {
    min-height: 40px;
  }
  .modal-body :deep(input.ctl),
  .modal-body :deep(textarea.ctl),
  .modal-body :deep(select.ctl) {
    font-size: 16px;
    min-height: 40px;
  }
}
</style>

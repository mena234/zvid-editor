<script setup lang="ts">
import { useEditorStore } from '~/stores/editor'
const editor = useEditorStore()

const GROUPS = [
  {
    title: 'Playback',
    items: [
      ['Space', 'Play / pause'],
      ['← / →', 'Step one frame (Shift: 1 s) — or nudge the selected element'],
      ['Home / End', 'Jump to start / end'],
      ['L', 'Toggle loop'],
      ['M', 'Toggle mute'],
    ],
  },
  {
    title: 'Editing',
    items: [
      ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
      ['Ctrl+D', 'Duplicate selection'],
      ['Delete', 'Delete selection'],
      ['S', 'Split the selected clip at the playhead'],
      ['Shift+click', 'Multi-select on the canvas'],
      ['↑↓←→', 'Nudge selected element 1 px (Shift: 10 px)'],
    ],
  },
  {
    title: 'View',
    items: [
      ['Ctrl+scroll', 'Zoom the canvas / timeline under the cursor'],
      ['Ctrl + / −', 'Zoom the timeline'],
      ['Esc', 'Clear selection / close dialogs'],
      ['?', 'This cheat sheet'],
    ],
  },
]
</script>

<template>
  <UiModal title="Keyboard shortcuts" width="560px" @close="editor.closeModal()">
    <div class="groups">
      <section v-for="g in GROUPS" :key="g.title">
        <h3>{{ g.title }}</h3>
        <div v-for="[keys, desc] in g.items" :key="keys" class="row">
          <span class="keys"
            ><kbd v-for="k in keys.split(' / ')" :key="k">{{ k }}</kbd></span
          >
          <span class="desc">{{ desc }}</span>
        </div>
      </section>
    </div>
  </UiModal>
</template>

<style scoped>
.groups {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
h3 {
  margin: 0 0 6px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--text-2);
}
.row {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 3px 0;
}
.keys {
  flex: 0 0 150px;
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.desc {
  font-size: 12px;
  color: var(--text-1);
}
</style>

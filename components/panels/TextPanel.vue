<script setup lang="ts">
/* Text elements (moved out of the old Add panel into its own rail tab).
   Quick presets add a plain TEXT visual; the Design tab handles animated,
   multi-layer text. */
import { useEditorContext } from '~/composables/useEditorContext'
import { round3 } from '~/utils/time'

const { project, editor, contextDuration } = useEditorContext()

function defaultTiming() {
  const t0 = round3(Math.min(editor.playhead, Math.max(0, contextDuration.value - 1)))
  return {
    enterBegin: t0 || undefined,
    exitEnd: round3(Math.min(contextDuration.value, t0 + 5)),
  }
}

interface TextPreset {
  key: string
  label: string
  sample: string
  text: string
  style: Record<string, string>
}

const PRESETS: TextPreset[] = [
  {
    key: 'heading',
    label: 'Heading',
    sample: 'Add a heading',
    text: 'Your heading',
    style: { fontSize: '96px', color: '#ffffff', fontWeight: '800' },
  },
  {
    key: 'subheading',
    label: 'Subheading',
    sample: 'Add a subheading',
    text: 'Your subheading',
    style: { fontSize: '56px', color: '#ffffff', fontWeight: '600' },
  },
  {
    key: 'body',
    label: 'Body',
    sample: 'Add a line of body text',
    text: 'Body text goes here',
    style: { fontSize: '36px', color: '#ffffff', fontWeight: '400' },
  },
  {
    key: 'caption',
    label: 'Caption',
    sample: 'Add a small caption',
    text: 'Caption',
    style: { fontSize: '24px', color: '#e5e7eb', fontWeight: '400' },
  },
]

function addText(preset: TextPreset) {
  const added = project.addVisual(editor.context, {
    type: 'TEXT',
    text: preset.text,
    position: 'center-center',
    style: preset.style,
    ...defaultTiming(),
  })
  editor.selectVisual(added._id)
  editor.notify('Text added — edit it in the inspector', 'success')
}
</script>

<template>
  <div class="text-panel">
    <h3 class="title">Text</h3>
    <div class="preset-list">
      <button
        v-for="p in PRESETS"
        :key="p.key"
        class="preset"
        @click="addText(p)"
      >
        <span
          class="preview"
          :style="{ fontWeight: p.style.fontWeight }"
          :class="p.key"
          >{{ p.sample }}</span
        >
        <span class="tag">{{ p.label }}</span>
      </button>
    </div>
    <button class="design-cta" @click="editor.openDesigner(null)">
      <UiIcon name="magic" :size="15" />
      <span>
        <b>Animated text?</b>
        Build layered, animated titles in the Design studio.
      </span>
    </button>
  </div>
</template>

<style scoped>
.text-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.title {
  margin: 0;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-1);
  text-transform: uppercase;
  letter-spacing: 0.4px;
}
.preset-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.preset {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 12px;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-m);
  background: var(--bg-2);
  color: var(--text-0);
  text-align: left;
}
.preset:hover {
  border-color: var(--accent);
  background: var(--bg-3);
}
.preview {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-0);
}
.preview.heading {
  font-size: 17px;
}
.preview.subheading {
  font-size: 14px;
}
.preview.body {
  font-size: 12px;
}
.preview.caption {
  font-size: 11px;
  color: var(--text-2);
}
.tag {
  flex: 0 0 auto;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--bg-1);
  color: var(--text-3);
  font-size: 9.5px;
  font-weight: 600;
}
.design-cta {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 2px;
  padding: 10px;
  border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
  border-radius: var(--radius-m);
  background: var(--accent-soft);
  color: var(--accent-strong);
  font-size: 11px;
  line-height: 1.4;
  text-align: left;
}
.design-cta:hover {
  border-color: var(--accent);
}
.design-cta :deep(svg) {
  flex: 0 0 auto;
  margin-top: 1px;
}
</style>

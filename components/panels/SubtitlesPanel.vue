<script setup lang="ts">
import { computed, ref } from 'vue'
import { useProjectStore } from '~/stores/project'
import { useEditorStore } from '~/stores/editor'
import {
  parseSrtVtt,
  parseWhisperJson,
  distributeWords,
} from '~/utils/subtitleRuntime'
import {
  SUBTITLE_MODES,
  SUBTITLE_POSITIONS,
} from '~/shared/schema/constants'
import { POPULAR_GOOGLE_FONTS } from '~/utils/fonts'
import { round3 } from '~/utils/time'

const project = useProjectStore()
const editor = useEditorStore()

const captions = computed(() => project.doc.subtitle?.captions ?? [])
const styles = computed(() => project.doc.subtitle?.styles ?? {})

const selectedIndex = computed(() =>
  editor.selectionKind === 'caption' ? editor.selectedCaptionIndex : -1
)
const selected = computed(() => captions.value[selectedIndex.value])

/* ---------------- captions CRUD ---------------- */
function addCaption() {
  const sub = project.ensureSubtitle()
  const t = round3(editor.playhead)
  const text = 'New caption'
  sub.captions.push({
    start: t,
    end: round3(t + 2),
    text,
    words: distributeWords(text, t, t + 2),
  })
  project.commit()
  editor.selectCaption(sub.captions.length - 1)
}

function removeCaption(i: number) {
  const sub = project.ensureSubtitle()
  sub.captions.splice(i, 1)
  project.commit()
  editor.clearSelection()
}

function patchCaption(i: number, patch: Record<string, any>, redistribute = false) {
  const c = captions.value[i]
  if (!c) return
  Object.assign(c, patch)
  if (redistribute) {
    c.words = distributeWords(c.text ?? '', c.start, c.end)
  }
  project.commit()
}

function retimeWordsEvenly(i: number) {
  const c = captions.value[i]
  if (!c) return
  c.words = distributeWords(
    c.text ?? c.words.map((w) => w.text).join(' '),
    c.start,
    c.end
  )
  project.commit()
}

function patchWord(ci: number, wi: number, patch: Record<string, any>) {
  const w = captions.value[ci]?.words?.[wi]
  if (!w) return
  Object.assign(w, patch)
  project.commit()
}

function splitCaption(i: number) {
  const c = captions.value[i]
  if (!c || (c.words?.length ?? 0) < 2) return
  const mid = Math.ceil(c.words.length / 2)
  const left = c.words.slice(0, mid)
  const right = c.words.slice(mid)
  const sub = project.ensureSubtitle()
  const rightCaption = {
    start: right[0].start,
    end: c.end,
    text: right.map((w) => w.text).join(' '),
    words: right,
  }
  c.end = left[left.length - 1].end
  c.text = left.map((w) => w.text).join(' ')
  c.words = left
  sub.captions.splice(i + 1, 0, rightCaption)
  project.commit()
}

function mergeWithNext(i: number) {
  const a = captions.value[i]
  const b = captions.value[i + 1]
  if (!a || !b) return
  a.end = b.end
  a.text = `${a.text ?? ''} ${b.text ?? ''}`.trim()
  a.words = [...(a.words ?? []), ...(b.words ?? [])]
  project.ensureSubtitle().captions.splice(i + 1, 1)
  project.commit()
}

/* ---------------- import ---------------- */
const fileInput = ref<HTMLInputElement>()

async function onImportFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const content = await file.text()
  try {
    let imported
    if (/\.(json)$/i.test(file.name)) {
      imported = parseWhisperJson(JSON.parse(content))
    } else {
      imported = parseSrtVtt(content)
    }
    if (!imported.length) throw new Error('no captions found')
    const sub = project.ensureSubtitle()
    sub.captions = imported
    project.commit()
    editor.notify(`Imported ${imported.length} captions`, 'success')
  } catch (err: any) {
    editor.notify(`Import failed: ${err.message}`, 'error')
  }
  ;(e.target as HTMLInputElement).value = ''
}

function patchStyles(patch: Record<string, any>) {
  project.patchSubtitleStyles(patch)
}

function fmtT(v: number) {
  return Math.round(v * 100) / 100
}
</script>

<template>
  <div class="subs-panel">
    <UiSection title="Captions">
      <template #actions>
        <button class="btn ghost sm" title="Import SRT / VTT / Whisper JSON" @click="fileInput?.click()">
          <UiIcon name="upload" :size="12" /> import
        </button>
        <input
          ref="fileInput"
          type="file"
          accept=".srt,.vtt,.json"
          hidden
          @change="onImportFile"
        />
      </template>

      <p v-if="!captions.length" class="hint">
        Word-timed captions burned into the video (karaoke, one-word and
        progressive modes). Import an SRT/VTT/Whisper JSON or add captions
        manually.
      </p>

      <div class="cap-list">
        <div
          v-for="(c, i) in captions"
          :key="i"
          class="cap-row"
          :class="{ active: selectedIndex === i }"
          role="button"
          tabindex="0"
          @click="editor.selectCaption(i); editor.seek(c.start + 0.01)"
        >
          <span class="cap-time mono">{{ fmtT(c.start) }}–{{ fmtT(c.end) }}</span>
          <span class="cap-text">{{ c.text ?? c.words?.map((w) => w.text).join(' ') }}</span>
          <button
            class="icon-btn xs"
            title="Delete caption"
            @click.stop="removeCaption(i)"
          >
            <UiIcon name="trash" :size="11" />
          </button>
        </div>
      </div>

      <button class="btn sm" @click="addCaption">
        <UiIcon name="plus" :size="12" /> Add caption at playhead
      </button>
    </UiSection>

    <UiSection v-if="selected" :title="`Caption ${selectedIndex + 1}`">
      <div class="grid-2">
        <UiField label="Start">
          <UiNumberInput
            :model-value="selected.start"
            :min="0"
            :step="0.1"
            unit="s"
            @update:model-value="patchCaption(selectedIndex, { start: $event ?? 0 })"
          />
        </UiField>
        <UiField label="End">
          <UiNumberInput
            :model-value="selected.end"
            :min="0"
            :step="0.1"
            unit="s"
            @update:model-value="patchCaption(selectedIndex, { end: $event ?? 0 })"
          />
        </UiField>
      </div>
      <UiField label="Text" hint="Editing the text redistributes word timings proportionally">
        <textarea
          class="ctl"
          rows="2"
          :value="selected.text ?? ''"
          @change="
            patchCaption(
              selectedIndex,
              { text: ($event.target as HTMLTextAreaElement).value },
              true
            )
          "
        />
      </UiField>

      <div class="word-head">
        <span class="hint">Word timings ({{ selected.words?.length ?? 0 }})</span>
        <span>
          <button class="btn ghost sm" @click="retimeWordsEvenly(selectedIndex)">
            even retime
          </button>
          <button class="btn ghost sm" @click="splitCaption(selectedIndex)">split</button>
          <button
            v-if="selectedIndex < captions.length - 1"
            class="btn ghost sm"
            @click="mergeWithNext(selectedIndex)"
          >
            merge ↓
          </button>
        </span>
      </div>
      <div class="word-grid">
        <template v-for="(w, wi) in selected.words" :key="wi">
          <input
            class="ctl w-text"
            :value="w.text"
            spellcheck="false"
            @change="patchWord(selectedIndex, wi, { text: ($event.target as HTMLInputElement).value })"
          />
          <UiNumberInput
            :model-value="w.start"
            :min="0"
            :step="0.05"
            @update:model-value="patchWord(selectedIndex, wi, { start: $event ?? 0 })"
          />
          <UiNumberInput
            :model-value="w.end"
            :min="0"
            :step="0.05"
            @update:model-value="patchWord(selectedIndex, wi, { end: $event ?? 0 })"
          />
        </template>
      </div>
    </UiSection>

    <UiSection title="Subtitle style" collapsible>
      <UiField label="Mode" hint="How words are revealed/highlighted">
        <select
          class="ctl"
          :value="styles.mode ?? 'normal'"
          @change="patchStyles({ mode: ($event.target as HTMLSelectElement).value })"
        >
          <option v-for="m in SUBTITLE_MODES" :key="m" :value="m">{{ m }}</option>
        </select>
      </UiField>
      <div class="grid-2">
        <UiField label="Font family">
          <select
            class="ctl"
            :value="styles.fontFamily ?? 'Poppins'"
            @change="patchStyles({ fontFamily: ($event.target as HTMLSelectElement).value })"
          >
            <option v-for="f in POPULAR_GOOGLE_FONTS" :key="f" :value="f">{{ f }}</option>
          </select>
        </UiField>
        <UiField label="Font size (px)">
          <UiNumberInput
            :model-value="styles.fontSize"
            :min="8"
            :max="400"
            placeholder="48"
            clearable
            @update:model-value="patchStyles({ fontSize: $event })"
          />
        </UiField>
      </div>
      <div class="grid-2">
        <UiField label="Color">
          <UiColorInput
            :model-value="styles.color"
            placeholder="#ffffff"
            clearable
            @update:model-value="patchStyles({ color: $event })"
          />
        </UiField>
        <UiField label="Active word color" hint="karaoke/one-word highlight">
          <UiColorInput
            :model-value="styles.activeWord?.color"
            clearable
            placeholder="none"
            @update:model-value="
              patchStyles({ activeWord: $event ? { color: $event } : undefined })
            "
          />
        </UiField>
      </div>
      <div class="grid-2">
        <UiField label="Bold">
          <input
            type="checkbox"
            :checked="styles.isBold ?? false"
            @change="patchStyles({ isBold: ($event.target as HTMLInputElement).checked || undefined })"
          />
        </UiField>
        <UiField label="Italic">
          <input
            type="checkbox"
            :checked="styles.isItalic ?? false"
            @change="patchStyles({ isItalic: ($event.target as HTMLInputElement).checked || undefined })"
          />
        </UiField>
      </div>
      <UiField label="Background" hint="Opaque caption box (disables outline)">
        <UiColorInput
          :model-value="styles.background"
          clearable
          placeholder="none"
          @update:model-value="patchStyles({ background: $event })"
        />
      </UiField>
      <div class="grid-2">
        <UiField label="Outline width">
          <UiNumberInput
            :model-value="styles.outline?.width"
            :min="0"
            :max="20"
            clearable
            placeholder="0"
            @update:model-value="
              patchStyles({
                outline: $event
                  ? { width: $event, color: styles.outline?.color ?? '#000000' }
                  : undefined,
              })
            "
          />
        </UiField>
        <UiField label="Outline color">
          <UiColorInput
            :model-value="styles.outline?.color"
            clearable
            @update:model-value="
              patchStyles({
                outline:
                  $event && (styles.outline?.width ?? 0) > 0
                    ? { width: styles.outline?.width ?? 2, color: $event }
                    : styles.outline
                      ? { ...styles.outline, color: $event ?? '#000000' }
                      : undefined,
              })
            "
          />
        </UiField>
      </div>
      <UiField label="Position">
        <select
          class="ctl"
          :value="styles.position ?? 'bottom-center'"
          @change="
            patchStyles({
              position:
                ($event.target as HTMLSelectElement).value === 'bottom-center'
                  ? undefined
                  : ($event.target as HTMLSelectElement).value,
            })
          "
        >
          <option value="bottom-center">bottom-center (default)</option>
          <option v-for="p in SUBTITLE_POSITIONS" :key="p" :value="p">{{ p }}</option>
        </select>
      </UiField>
      <div class="grid-2">
        <UiField label="Vertical margin">
          <UiNumberInput
            :model-value="styles.marginV"
            :min="0"
            clearable
            placeholder="40"
            unit="px"
            @update:model-value="patchStyles({ marginV: $event })"
          />
        </UiField>
        <UiField label="Horizontal margin">
          <UiNumberInput
            :model-value="styles.marginH"
            :min="0"
            clearable
            placeholder="40"
            unit="px"
            @update:model-value="patchStyles({ marginH: $event })"
          />
        </UiField>
      </div>
      <UiField label="Text transform">
        <select
          class="ctl"
          :value="styles.textTransform ?? ''"
          @change="
            patchStyles({
              textTransform: ($event.target as HTMLSelectElement).value || undefined,
            })
          "
        >
          <option value="">none</option>
          <option value="uppercase">uppercase</option>
          <option value="lowercase">lowercase</option>
          <option value="capitalize">capitalize</option>
        </select>
      </UiField>
      <p class="hint">
        Preview approximates the burned-in ASS subtitles — spot-check a real
        render for exact font metrics.
      </p>
    </UiSection>
  </div>
</template>

<style scoped>
.cap-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-height: 220px;
  overflow-y: auto;
  margin-bottom: 8px;
}
.cap-row {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 7px;
  border-radius: var(--radius-s);
  border: 1px solid transparent;
  cursor: pointer;
}
.cap-row:hover {
  background: var(--bg-2);
}
.cap-row.active {
  border-color: var(--orange);
  background: rgba(255, 153, 80, 0.08);
}
.cap-time {
  font-size: 9.5px;
  color: var(--text-3);
  flex: 0 0 auto;
}
.cap-text {
  flex: 1;
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.icon-btn.xs {
  width: 20px;
  height: 20px;
}
.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.word-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 4px;
}
.word-grid {
  display: grid;
  grid-template-columns: 1fr 62px 62px;
  gap: 4px;
  max-height: 200px;
  overflow-y: auto;
}
.w-text {
  font-size: 11px;
}
</style>

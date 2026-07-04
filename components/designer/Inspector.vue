<script setup lang="ts">
import { computed, ref } from 'vue'
import type {
  DesignDoc,
  DesignLayer,
  LayerAnim,
  TextLayer,
} from '~/utils/designer/types'
import { ANIM_GROUPS, ANIM_PRESETS, EASINGS, animPreset } from '~/utils/designer/animations'
import { SHAPES, SHAPE_GROUPS, shapeDef, shapePreviewSvg } from '~/utils/designer/shapes'
import { POPULAR_GOOGLE_FONTS, loadGoogleFont } from '~/utils/fonts'

const props = defineProps<{
  design: DesignDoc
  layer: DesignLayer | null
  /** compiled loop duration — shown next to the “auto” toggle */
  resolvedDuration: number
}>()

const emit = defineEmits<{
  patchDesign: [patch: Record<string, any>]
  patchLayer: [id: string, patch: Record<string, any>]
}>()

function patchL(patch: Record<string, any>) {
  if (props.layer) emit('patchLayer', props.layer.id, patch)
}

const textLayer = computed(() =>
  props.layer?.kind === 'text' ? (props.layer as TextLayer) : null
)

/* ---------------- animation ---------------- */
const presetGroups = computed(() => {
  const kind = props.layer?.kind ?? 'text'
  return ANIM_GROUPS.map((g) => ({
    group: g,
    presets: Object.values(ANIM_PRESETS).filter(
      (p) => p.group === g && (kind === 'text' || !p.textOnly)
    ),
  })).filter((g) => g.presets.length)
})

const currentPreset = computed(() => animPreset(props.layer?.anim?.preset))

function onPresetChange(id: string) {
  if (!props.layer) return
  if (!id) {
    patchL({ anim: null })
    return
  }
  const def = ANIM_PRESETS[id]
  const prev = props.layer.anim
  const anim: LayerAnim = {
    preset: id,
    duration: def.defaults.duration,
    delay: prev?.delay ?? 0,
    stagger: def.defaults.stagger ?? 0.06,
    easing: prev?.easing ?? 'smooth',
    dir: prev?.dir ?? 'up',
  }
  patchL({ anim })
}

function patchAnim(part: Partial<LayerAnim>) {
  if (!props.layer?.anim) return
  patchL({ anim: { ...props.layer.anim, ...part } })
}

/* ---------------- text style toggles ---------------- */
function toggleStroke(on: boolean) {
  patchL({ stroke: on ? { width: 2, color: '#0b0d12' } : undefined })
}
function toggleShadow(on: boolean) {
  patchL({ shadow: on ? { x: 0, y: 6, blur: 18, color: 'rgba(0,0,0,0.45)' } : undefined })
}
function togglePill(on: boolean) {
  patchL({ pill: on ? { color: '#8b5cf6', padX: 22, padY: 8, radius: 12 } : undefined })
}

const FONT_WEIGHTS = ['300', '400', '500', '600', '700', '800', '900']

/* ---------------- shape picker ---------------- */
const shapeGroups = computed(() =>
  SHAPE_GROUPS.map((g) => ({
    group: g,
    shapes: Object.entries(SHAPES)
      .filter(([, d]) => d.group === g)
      .map(([key, d]) => ({ key, label: d.label, svg: shapePreviewSvg(key) })),
  }))
)

function pickShape(key: string) {
  if (props.layer?.kind !== 'shape') return
  const def = shapeDef(key)
  const w = props.layer.width
  patchL({ shape: key, height: def.ratio ? Math.round(w / def.ratio) : props.layer.height })
}

const currentShapeDef = computed(() =>
  props.layer?.kind === 'shape' ? shapeDef(props.layer.shape) : null
)
const shapeUsesStroke = computed(
  () =>
    !!currentShapeDef.value &&
    (currentShapeDef.value.strokeBased || props.layer?.kind === 'shape' && props.layer.shape === 'ring')
)
const shapeUsesRadius = computed(
  () => props.layer?.kind === 'shape' && (props.layer.shape === 'rect' || props.layer.shape === 'bar')
)

/* ---------------- font picker ---------------- */
const fontQuery = ref('')
const fontOpen = ref(false)
const fontMatches = computed(() => {
  const q = fontQuery.value.toLowerCase()
  return POPULAR_GOOGLE_FONTS.filter((f) => f.toLowerCase().includes(q)).slice(0, 30)
})
function pickFont(f: string) {
  loadGoogleFont(f)
  emit('patchDesign', { fontFamily: f })
  fontOpen.value = false
  fontQuery.value = ''
}

/* ---------------- background ---------------- */
function patchBg(part: Record<string, any>) {
  emit('patchDesign', { background: { ...props.design.background, ...part } })
}
</script>

<template>
  <div class="inspector-body">
    <!-- ======================= layer selected ======================= -->
    <template v-if="layer">
      <UiSection :title="`${layer.kind} layer`">
        <UiField v-if="layer.kind !== 'text'" label="Name">
          <input
            class="ctl"
            :value="layer.name"
            @change="patchL({ name: ($event.target as HTMLInputElement).value })"
          />
        </UiField>
        <div class="grid-2">
          <UiField label="X">
            <UiNumberInput
              :model-value="layer.x"
              :step="1"
              unit="%"
              @update:model-value="patchL({ x: $event ?? 50 })"
            />
          </UiField>
          <UiField label="Y">
            <UiNumberInput
              :model-value="layer.y"
              :step="1"
              unit="%"
              @update:model-value="patchL({ y: $event ?? 50 })"
            />
          </UiField>
        </div>
        <div class="grid-3">
          <UiField label="Rotate">
            <UiNumberInput
              :model-value="layer.rotate"
              :step="1"
              unit="°"
              @update:model-value="patchL({ rotate: $event ?? 0 })"
            />
          </UiField>
          <UiField label="Scale">
            <UiNumberInput
              :model-value="layer.scale"
              :min="0.05"
              :max="10"
              :step="0.05"
              @update:model-value="patchL({ scale: $event ?? 1 })"
            />
          </UiField>
          <UiField label="Opacity">
            <UiNumberInput
              :model-value="layer.opacity"
              :min="0"
              :max="1"
              :step="0.05"
              @update:model-value="patchL({ opacity: $event ?? 1 })"
            />
          </UiField>
        </div>
      </UiSection>

      <!-- ---------- text ---------- -->
      <template v-if="textLayer">
        <UiSection title="Text">
          <textarea
            class="ctl"
            rows="3"
            :value="textLayer.text"
            @input="patchL({ text: ($event.target as HTMLTextAreaElement).value })"
          />
          <div class="grid-2">
            <UiField label="Size">
              <UiNumberInput
                :model-value="textLayer.fontSize"
                :min="6"
                :max="500"
                unit="px"
                @update:model-value="patchL({ fontSize: $event ?? 64 })"
              />
            </UiField>
            <UiField label="Weight">
              <select
                class="ctl"
                :value="textLayer.fontWeight"
                @change="patchL({ fontWeight: ($event.target as HTMLSelectElement).value })"
              >
                <option v-for="w in FONT_WEIGHTS" :key="w" :value="w">{{ w }}</option>
              </select>
            </UiField>
          </div>
          <div class="grid-2">
            <UiField label="Spacing">
              <UiNumberInput
                :model-value="textLayer.letterSpacing"
                :min="-0.2"
                :max="2"
                :step="0.01"
                unit="em"
                @update:model-value="patchL({ letterSpacing: $event ?? 0 })"
              />
            </UiField>
            <UiField label="Line height">
              <UiNumberInput
                :model-value="textLayer.lineHeight"
                :min="0.6"
                :max="3"
                :step="0.05"
                @update:model-value="patchL({ lineHeight: $event ?? 1.15 })"
              />
            </UiField>
          </div>
          <div class="grid-2">
            <UiField label="Align">
              <select
                class="ctl"
                :value="textLayer.align"
                @change="patchL({ align: ($event.target as HTMLSelectElement).value })"
              >
                <option value="left">left</option>
                <option value="center">center</option>
                <option value="right">right</option>
              </select>
            </UiField>
            <UiField label="Case">
              <select
                class="ctl"
                :value="textLayer.textTransform"
                @change="patchL({ textTransform: ($event.target as HTMLSelectElement).value })"
              >
                <option value="">as typed</option>
                <option value="uppercase">UPPERCASE</option>
                <option value="lowercase">lowercase</option>
                <option value="capitalize">Capitalize</option>
              </select>
            </UiField>
          </div>
          <UiField label="Wrap width" hint="empty = hug content">
            <UiNumberInput
              :model-value="textLayer.width"
              :min="20"
              :max="4000"
              clearable
              placeholder="auto"
              unit="px"
              @update:model-value="patchL({ width: $event })"
            />
          </UiField>
        </UiSection>

        <UiSection title="Fill">
          <DesignerPaintInput
            :model-value="textLayer.fill"
            @update:model-value="patchL({ fill: $event })"
          />
        </UiSection>

        <UiSection title="Outline" collapsible :start-open="!!textLayer.stroke">
          <template #actions>
            <input
              type="checkbox"
              :checked="!!textLayer.stroke"
              @click.stop
              @change="toggleStroke(($event.target as HTMLInputElement).checked)"
            />
          </template>
          <template v-if="textLayer.stroke">
            <div class="grid-2">
              <UiField label="Width">
                <UiNumberInput
                  :model-value="textLayer.stroke.width"
                  :min="0.5"
                  :max="30"
                  :step="0.5"
                  unit="px"
                  @update:model-value="patchL({ stroke: { ...textLayer!.stroke!, width: $event ?? 2 } })"
                />
              </UiField>
              <UiField label="Color">
                <UiColorInput
                  :model-value="textLayer.stroke.color"
                  @update:model-value="patchL({ stroke: { ...textLayer!.stroke!, color: $event ?? '#000' } })"
                />
              </UiField>
            </div>
          </template>
        </UiSection>

        <UiSection title="Shadow" collapsible :start-open="!!textLayer.shadow">
          <template #actions>
            <input
              type="checkbox"
              :checked="!!textLayer.shadow"
              @click.stop
              @change="toggleShadow(($event.target as HTMLInputElement).checked)"
            />
          </template>
          <template v-if="textLayer.shadow">
            <div class="grid-3">
              <UiField label="X">
                <UiNumberInput
                  :model-value="textLayer.shadow.x"
                  :step="1"
                  unit="px"
                  @update:model-value="patchL({ shadow: { ...textLayer!.shadow!, x: $event ?? 0 } })"
                />
              </UiField>
              <UiField label="Y">
                <UiNumberInput
                  :model-value="textLayer.shadow.y"
                  :step="1"
                  unit="px"
                  @update:model-value="patchL({ shadow: { ...textLayer!.shadow!, y: $event ?? 0 } })"
                />
              </UiField>
              <UiField label="Blur">
                <UiNumberInput
                  :model-value="textLayer.shadow.blur"
                  :min="0"
                  :step="1"
                  unit="px"
                  @update:model-value="patchL({ shadow: { ...textLayer!.shadow!, blur: $event ?? 0 } })"
                />
              </UiField>
            </div>
            <UiField label="Color">
              <UiColorInput
                :model-value="textLayer.shadow.color"
                @update:model-value="patchL({ shadow: { ...textLayer!.shadow!, color: $event ?? '#000' } })"
              />
            </UiField>
          </template>
        </UiSection>

        <UiSection title="Highlight pill" collapsible :start-open="!!textLayer.pill">
          <template #actions>
            <input
              type="checkbox"
              :checked="!!textLayer.pill"
              @click.stop
              @change="togglePill(($event.target as HTMLInputElement).checked)"
            />
          </template>
          <template v-if="textLayer.pill">
            <UiField label="Color">
              <UiColorInput
                :model-value="textLayer.pill.color"
                @update:model-value="patchL({ pill: { ...textLayer!.pill!, color: $event ?? '#8b5cf6' } })"
              />
            </UiField>
            <div class="grid-3">
              <UiField label="Pad X">
                <UiNumberInput
                  :model-value="textLayer.pill.padX"
                  :min="0"
                  unit="px"
                  @update:model-value="patchL({ pill: { ...textLayer!.pill!, padX: $event ?? 0 } })"
                />
              </UiField>
              <UiField label="Pad Y">
                <UiNumberInput
                  :model-value="textLayer.pill.padY"
                  :min="0"
                  unit="px"
                  @update:model-value="patchL({ pill: { ...textLayer!.pill!, padY: $event ?? 0 } })"
                />
              </UiField>
              <UiField label="Radius">
                <UiNumberInput
                  :model-value="textLayer.pill.radius"
                  :min="0"
                  unit="px"
                  @update:model-value="patchL({ pill: { ...textLayer!.pill!, radius: $event ?? 0 } })"
                />
              </UiField>
            </div>
          </template>
        </UiSection>
      </template>

      <!-- ---------- shape ---------- -->
      <template v-else-if="layer.kind === 'shape'">
        <UiSection title="Shape">
          <div v-for="g in shapeGroups" :key="g.group" class="shape-group">
            <span class="shape-group-label">{{ g.group }}</span>
            <div class="shape-grid">
              <button
                v-for="s in g.shapes"
                :key="s.key"
                class="shape-btn"
                :class="{ on: layer.shape === s.key }"
                :title="s.label"
                @click="pickShape(s.key)"
              >
                <span class="shape-svg" v-html="s.svg" />
              </button>
            </div>
          </div>
          <div class="grid-2">
            <UiField label="Width">
              <UiNumberInput
                :model-value="layer.width"
                :min="2"
                :max="4000"
                unit="px"
                @update:model-value="patchL({ width: $event ?? 100 })"
              />
            </UiField>
            <UiField label="Height">
              <UiNumberInput
                :model-value="layer.height"
                :min="2"
                :max="4000"
                unit="px"
                @update:model-value="patchL({ height: $event ?? 100 })"
              />
            </UiField>
          </div>
          <UiField v-if="shapeUsesStroke" label="Stroke width">
            <UiNumberInput
              :model-value="layer.strokeWidth"
              :min="1"
              :max="80"
              unit="px"
              @update:model-value="patchL({ strokeWidth: $event ?? 8 })"
            />
          </UiField>
          <UiField v-if="shapeUsesRadius" label="Corner radius">
            <UiNumberInput
              :model-value="layer.radius"
              :min="0"
              :max="500"
              unit="px"
              @update:model-value="patchL({ radius: $event ?? 0 })"
            />
          </UiField>
        </UiSection>

        <UiSection title="Fill">
          <DesignerPaintInput
            :model-value="layer.fill"
            @update:model-value="patchL({ fill: $event })"
          />
          <p v-if="shapeUsesStroke" class="hint">
            Stroke shapes use the solid color (gradients fall back to their first stop).
          </p>
        </UiSection>
      </template>

      <!-- ---------- image ---------- -->
      <template v-else-if="layer.kind === 'image'">
        <UiSection title="Image">
          <UiField label="URL" hint="must stay reachable by the render machine">
            <input
              class="ctl mono"
              :value="layer.src"
              placeholder="https://…/photo.png"
              spellcheck="false"
              @change="patchL({ src: ($event.target as HTMLInputElement).value.trim() })"
            />
          </UiField>
          <div class="grid-2">
            <UiField label="Width">
              <UiNumberInput
                :model-value="layer.width"
                :min="2"
                :max="4000"
                unit="px"
                @update:model-value="patchL({ width: $event ?? 200 })"
              />
            </UiField>
            <UiField label="Height">
              <UiNumberInput
                :model-value="layer.height"
                :min="2"
                :max="4000"
                unit="px"
                @update:model-value="patchL({ height: $event ?? 200 })"
              />
            </UiField>
          </div>
          <div class="grid-2">
            <UiField label="Radius">
              <UiNumberInput
                :model-value="layer.radius"
                :min="0"
                :max="1000"
                unit="px"
                @update:model-value="patchL({ radius: $event ?? 0 })"
              />
            </UiField>
            <UiField label="Fit">
              <select
                class="ctl"
                :value="layer.fit"
                @change="patchL({ fit: ($event.target as HTMLSelectElement).value })"
              >
                <option value="cover">cover</option>
                <option value="contain">contain</option>
                <option value="fill">fill</option>
              </select>
            </UiField>
          </div>
        </UiSection>
      </template>

      <!-- ---------- animation ---------- -->
      <UiSection title="Animation">
        <select
          class="ctl"
          :value="layer.anim?.preset ?? ''"
          @change="onPresetChange(($event.target as HTMLSelectElement).value)"
        >
          <option value="">None (static)</option>
          <optgroup v-for="g in presetGroups" :key="g.group" :label="g.group">
            <option v-for="p in g.presets" :key="p.id" :value="p.id">{{ p.label }}</option>
          </optgroup>
        </select>
        <p v-if="currentPreset" class="hint">{{ currentPreset.hint }}</p>

        <template v-if="layer.anim && currentPreset">
          <div class="grid-2">
            <UiField :label="currentPreset.infinite ? 'Period' : 'Duration'">
              <UiNumberInput
                :model-value="layer.anim.duration"
                :min="0.05"
                :max="15"
                :step="0.05"
                unit="s"
                @update:model-value="patchAnim({ duration: $event ?? currentPreset!.defaults.duration })"
              />
            </UiField>
            <UiField v-if="!currentPreset.infinite" label="Delay">
              <UiNumberInput
                :model-value="layer.anim.delay"
                :min="0"
                :max="14"
                :step="0.05"
                unit="s"
                @update:model-value="patchAnim({ delay: $event ?? 0 })"
              />
            </UiField>
          </div>
          <div class="grid-2">
            <UiField v-if="currentPreset.split" label="Stagger" hint="delay between letters/words">
              <UiNumberInput
                :model-value="layer.anim.stagger"
                :min="0"
                :max="1"
                :step="0.01"
                unit="s"
                @update:model-value="patchAnim({ stagger: $event ?? 0.06 })"
              />
            </UiField>
            <UiField v-if="currentPreset.hasEasing" label="Easing">
              <select
                class="ctl"
                :value="layer.anim.easing"
                @change="patchAnim({ easing: ($event.target as HTMLSelectElement).value })"
              >
                <option v-for="(e, id) in EASINGS" :key="id" :value="id">{{ e.label }}</option>
              </select>
            </UiField>
            <UiField v-if="currentPreset.hasDirection" label="From">
              <select
                class="ctl"
                :value="layer.anim.dir"
                @change="patchAnim({ dir: ($event.target as HTMLSelectElement).value as LayerAnim['dir'] })"
              >
                <option value="up">bottom</option>
                <option value="down">top</option>
                <option value="left">right</option>
                <option value="right">left</option>
              </select>
            </UiField>
          </div>
        </template>
      </UiSection>
    </template>

    <!-- ======================= canvas (no selection) ======================= -->
    <template v-else>
      <UiSection title="Canvas">
        <div class="grid-2">
          <UiField label="Width">
            <UiNumberInput
              :model-value="design.width"
              :min="40"
              :max="4000"
              unit="px"
              @update:model-value="emit('patchDesign', { width: $event ?? 800 })"
            />
          </UiField>
          <UiField label="Height">
            <UiNumberInput
              :model-value="design.height"
              :min="40"
              :max="4000"
              unit="px"
              @update:model-value="emit('patchDesign', { height: $event ?? 450 })"
            />
          </UiField>
        </div>
      </UiSection>

      <UiSection title="Background">
        <select
          class="ctl"
          :value="design.background.kind"
          @change="patchBg({ kind: ($event.target as HTMLSelectElement).value })"
        >
          <option value="none">transparent</option>
          <option value="solid">solid color</option>
          <option value="gradient">gradient</option>
        </select>
        <template v-if="design.background.kind === 'solid'">
          <UiColorInput
            :model-value="design.background.color"
            @update:model-value="patchBg({ color: $event ?? '#101321' })"
          />
        </template>
        <template v-else-if="design.background.kind === 'gradient'">
          <div class="grid-2">
            <UiColorInput
              :model-value="design.background.from"
              @update:model-value="patchBg({ from: $event ?? '#1b2340' })"
            />
            <UiColorInput
              :model-value="design.background.to"
              @update:model-value="patchBg({ to: $event ?? '#0c0f1c' })"
            />
          </div>
          <UiField label="Angle">
            <UiNumberInput
              :model-value="design.background.angle"
              :min="0"
              :max="360"
              :step="5"
              unit="°"
              @update:model-value="patchBg({ angle: $event ?? 135 })"
            />
          </UiField>
        </template>
        <UiField v-if="design.background.kind !== 'none'" label="Corner radius">
          <UiNumberInput
            :model-value="design.background.radius"
            :min="0"
            :max="400"
            unit="px"
            @update:model-value="patchBg({ radius: $event ?? 0 })"
          />
        </UiField>
      </UiSection>

      <UiSection title="Font">
        <div class="font-picker">
          <button class="ctl font-btn" @click="fontOpen = !fontOpen">
            <span :style="{ fontFamily: `'${design.fontFamily}'` }">{{ design.fontFamily }}</span>
            <UiIcon name="chevron_down" :size="12" />
          </button>
          <div v-if="fontOpen" class="font-menu">
            <input v-model="fontQuery" class="ctl" placeholder="Search fonts…" autofocus />
            <div class="font-list">
              <button v-for="f in fontMatches" :key="f" class="font-item" @click="pickFont(f)">
                {{ f }}
              </button>
              <button
                v-if="fontQuery && !fontMatches.some((f) => f.toLowerCase() === fontQuery.toLowerCase())"
                class="font-item custom"
                @click="pickFont(fontQuery)"
              >
                Use “{{ fontQuery }}” (any Google Font name works)
              </button>
            </div>
          </div>
        </div>
        <p class="hint">One Google Font per design — the render loads it automatically.</p>
      </UiSection>

      <UiSection title="Loop">
        <label class="check-row">
          <input
            type="checkbox"
            :checked="design.duration === 'auto'"
            @change="
              emit('patchDesign', {
                duration: ($event.target as HTMLInputElement).checked ? 'auto' : resolvedDuration,
              })
            "
          />
          Auto duration ({{ resolvedDuration.toFixed(2) }}s)
        </label>
        <UiField v-if="design.duration !== 'auto'" label="Loop duration" hint="max 15s">
          <UiNumberInput
            :model-value="typeof design.duration === 'number' ? design.duration : undefined"
            :min="0.1"
            :max="15"
            :step="0.1"
            unit="s"
            @update:model-value="emit('patchDesign', { duration: $event ?? 'auto' })"
          />
        </UiField>
        <p class="hint">
          The render captures one loop and repeats it for the element's whole
          time on screen. Entrances play at the start of each loop.
        </p>
      </UiSection>
    </template>
  </div>
</template>

<style scoped>
.inspector-body {
  overflow-y: auto;
  min-height: 0;
  padding-right: 2px;
}
.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.grid-3 {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 6px;
}
.shape-group {
  margin-bottom: 6px;
}
.shape-group-label {
  display: block;
  font-size: 9.5px;
  color: var(--text-3);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 3px;
}
.shape-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 3px;
}
.shape-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 1;
  padding: 3px;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-s);
  background: var(--bg-2);
  color: var(--text-1);
}
.shape-btn:hover {
  border-color: var(--accent);
  color: var(--text-0);
}
.shape-btn.on {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-strong);
}
.shape-svg {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
}
.shape-svg :deep(svg),
.shape-svg :deep(span) {
  max-width: 100%;
  max-height: 100%;
}
.check-row {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11.5px;
  color: var(--text-1);
}
.font-picker {
  position: relative;
  width: 100%;
}
.font-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
}
.font-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 60;
  background: var(--bg-3);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-m);
  box-shadow: var(--shadow-2);
  padding: 6px;
}
.font-list {
  max-height: 200px;
  overflow-y: auto;
  margin-top: 5px;
}
.font-item {
  display: block;
  width: 100%;
  padding: 5px 8px;
  border: none;
  background: none;
  color: var(--text-0);
  font-size: 12px;
  text-align: left;
  border-radius: var(--radius-s);
}
.font-item:hover {
  background: var(--bg-4);
}
.font-item.custom {
  color: var(--accent-strong);
  font-size: 11px;
}
</style>

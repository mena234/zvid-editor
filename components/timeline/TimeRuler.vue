<script setup lang="ts">
import { computed } from 'vue'
import { pickTickStep, formatTimeShort } from '~/utils/time'

const props = defineProps<{
  width: number
  pxPerSec: number
  duration: number
}>()

const ticks = computed(() => {
  const { major, minor } = pickTickStep(props.pxPerSec)
  const end = props.width / props.pxPerSec
  const out: { t: number; x: number; major: boolean; label?: string }[] = []
  for (let t = 0; t <= end; t += minor) {
    const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6
    out.push({
      t,
      x: t * props.pxPerSec,
      major: isMajor,
      label: isMajor ? formatTimeShort(Math.round(t * 100) / 100) : undefined,
    })
  }
  return out
})
</script>

<template>
  <div class="ruler" :style="{ width: `${width}px` }">
    <template v-for="tick in ticks" :key="tick.t">
      <div
        class="tick"
        :class="{ major: tick.major }"
        :style="{ left: `${tick.x}px` }"
      />
      <span v-if="tick.label" class="tick-label" :style="{ left: `${tick.x + 4}px` }">
        {{ tick.label }}
      </span>
    </template>
    <div class="duration-mark" :style="{ left: `${duration * pxPerSec}px` }" />
  </div>
</template>

<style scoped>
.ruler {
  position: relative;
  height: 26px;
  user-select: none;
  overflow: hidden;
}
.tick {
  position: absolute;
  bottom: 0;
  width: 1px;
  height: 6px;
  background: var(--border-2);
}
.tick.major {
  height: 11px;
  background: var(--text-3);
}
.tick-label {
  position: absolute;
  top: 2px;
  font-size: 9.5px;
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.duration-mark {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: color-mix(in srgb, var(--red) 70%, transparent);
}
</style>

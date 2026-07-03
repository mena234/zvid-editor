<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { xfadeToCss, isApproximateEffect } from '~/utils/xfadeCss'

const props = defineProps<{ effect: string; direction?: 'enter' | 'exit' }>()

const style = ref<Record<string, any>>({})
let raf = 0
let start = 0

function loop(ts: number) {
  if (!start) start = ts
  const cycle = 1600
  let p = ((ts - start) % cycle) / (cycle * 0.7)
  p = Math.min(1, p) // hold at 1 for the tail of the cycle
  const prog = props.direction === 'exit' ? 1 - p : p
  const s = xfadeToCss(props.effect, prog)
  style.value = {
    opacity: s.opacity,
    clipPath: s.clipPath,
    transform: s.transform,
    filter: s.filter,
  }
  raf = requestAnimationFrame(loop)
}

onMounted(() => (raf = requestAnimationFrame(loop)))
onBeforeUnmount(() => cancelAnimationFrame(raf))
watch(
  () => props.effect,
  () => (start = 0)
)
</script>

<template>
  <div class="xf-preview" :title="effect">
    <div class="xf-inner" :style="style">
      <span>Aa</span>
    </div>
    <span v-if="isApproximateEffect(effect)" class="approx" title="Approximate preview — the final render uses FFmpeg xfade">≈</span>
  </div>
</template>

<style scoped>
.xf-preview {
  position: relative;
  width: 100%;
  height: 54px;
  border-radius: var(--radius-s);
  background:
    linear-gradient(45deg, var(--bg-3) 25%, transparent 25%),
    linear-gradient(-45deg, var(--bg-3) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, var(--bg-3) 75%),
    linear-gradient(-45deg, transparent 75%, var(--bg-3) 75%);
  background-size: 12px 12px;
  background-color: var(--bg-1);
  overflow: hidden;
  border: 1px solid var(--border-1);
}
.xf-inner {
  position: absolute;
  inset: 8px;
  border-radius: 4px;
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 800;
  font-size: 16px;
}
.approx {
  position: absolute;
  top: 2px;
  right: 5px;
  color: var(--yellow);
  font-size: 12px;
  font-weight: 700;
}
</style>

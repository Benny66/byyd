<script setup lang="ts">
import { computed } from 'vue'
import type { Phase } from '~/data/training'

const props = defineProps<{
  phases: Phase[]
  /** 整体完成百分比 0-100 */
  percent: number
}>()

const clip = computed(() => {
  const done = Math.min(100, Math.max(0, props.percent))
  const value = `inset(0 ${(100 - done).toFixed(3)}% 0 0)`
  // 同时给出 -webkit- 前缀，兼容旧版 Safari
  return `clip-path:${value};-webkit-clip-path:${value}`
})

/** 进度条只画"动作 / 休息"段，5 秒准备不单独占一格，否则色块太碎 */
const segments = computed(() => props.phases.filter((phase) => phase.type !== 'prepare'))
</script>

<template>
  <div class="progress" role="progressbar" :aria-valuenow="Math.round(percent)" aria-valuemin="0" aria-valuemax="100">
    <div class="pb-track">
      <div
        v-for="(item, i) in segments"
        :key="`t-${i}`"
        class="pb-seg"
        :class="{ 'pb-seg-rest': item.type === 'rest' }"
      />
    </div>
    <div class="pb-fill" :style="clip">
      <div
        v-for="(item, i) in segments"
        :key="`f-${i}`"
        class="pb-seg"
        :class="{ 'pb-seg-rest': item.type === 'rest' }"
      />
    </div>
  </div>
</template>

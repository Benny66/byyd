<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  /** 当前阶段剩余比例 0-1 */
  ratio: number
  tag: string
  countdown: string
}>()

const CIRC = 2 * Math.PI * 86 // 环周长（r=86）
const dasharray = CIRC.toFixed(2)

const safeRatio = computed(() => Math.min(1, Math.max(0, props.ratio)))
const dashoffset = computed(() => (CIRC * (1 - safeRatio.value)).toFixed(2))
</script>

<template>
  <div class="ring-wrap">
    <svg class="ring" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <circle class="ring-track" cx="100" cy="100" r="86" />
      <circle
        class="ring-glow"
        cx="100"
        cy="100"
        r="86"
        transform="rotate(-90 100 100)"
        :style="{ strokeDasharray: dasharray, strokeDashoffset: dashoffset }"
      />
      <circle
        class="ring-fill"
        cx="100"
        cy="100"
        r="86"
        transform="rotate(-90 100 100)"
        :style="{ strokeDasharray: dasharray, strokeDashoffset: dashoffset }"
      />
    </svg>
    <div class="ring-text">
      <div class="phase-tag">{{ tag }}</div>
      <div class="countdown">{{ countdown }}</div>
    </div>
  </div>
</template>

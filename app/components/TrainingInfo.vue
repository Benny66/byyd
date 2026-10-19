<script setup lang="ts">
defineProps<{
  isRest: boolean
  actionName: string
  tips: string
  breathe: string
  nextPrefix: string
  nextLabel: string
}>()
</script>

<template>
  <div class="info">
    <h1 class="action-name">{{ actionName }}</h1>
    <p class="line tips">
      <!-- 休息时不需要"要点"标签 -->
      <span v-if="!isRest" class="label">要点</span>
      <span>{{ tips }}</span>
    </p>
    <p class="line breathe">
      <span class="label">呼吸</span>
      <span>{{ breathe }}</span>
    </p>
  </div>

  <div class="next-line">{{ nextPrefix }}<b>{{ nextLabel }}</b></div>
</template>

<script setup lang="ts">
defineProps<{
  show: boolean
  totalMinutes: number
  todayCount: number
  weekCount: number
  weekDots: { day: string; done: boolean }[]
}>()

const emit = defineEmits<{
  (e: 'restart'): void
  (e: 'open-board'): void
}>()
</script>

<template>
  <div class="finish" :class="{ show }" role="dialog" aria-label="训练完成" :aria-hidden="!show">
    <div class="finish-title">{{ totalMinutes }} 分钟完成</div>
    <div class="finish-sub">今天第 {{ todayCount }} 次 · 本周 {{ weekCount }} 天</div>

    <div class="finish-dots" aria-hidden="true">
      <span
        v-for="cell in weekDots"
        :key="cell.day"
        class="finish-dot"
        :class="{ done: cell.done }"
        :title="cell.day"
      />
    </div>

    <div class="finish-warn">强度以能正常说话为准，出现不适立即停止。</div>

    <div class="finish-actions">
      <button class="btn" type="button" @click="emit('open-board')">
        <svg class="ico" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 19h4v-7H4v7zm6 0h4V5h-4v14zm6 0h4v-10h-4v10z" />
        </svg>
        <span>看周榜</span>
      </button>
      <button class="btn btn-main" type="button" @click="emit('restart')">
        <svg class="ico" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 4V1L7 6l5 5V6a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z" />
        </svg>
        <span>再来一遍</span>
      </button>
    </div>
  </div>
</template>

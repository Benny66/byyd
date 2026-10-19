<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useTrainingPlayer } from '~/composables/useTrainingPlayer'
import { useCheckin } from '~/composables/useCheckin'
import { useUiState } from '~/composables/useUiState'

const {
  isPseudoFullscreen,
  isRest,
  statusText,
  totalLeftText,
  ringRatio,
  phaseTag,
  countdownText,
  actionName,
  tipsText,
  breatheText,
  nextHint,
  phases,
  progressPercent,
  totalMinutes,
  running,
  finished,
  playLabel,
  soundOn,
  voiceOn,
  musicOn,
  togglePlay,
  pause,
  prev,
  next,
  restart,
  toggleSound,
  toggleVoice,
  toggleMusic,
  toggleFullscreen
} = useTrainingPlayer()

const checkin = useCheckin()
const { openPanel } = useUiState()

onMounted(() => {
  checkin.hydrate()
})

const todayLabel = computed(() =>
  checkin.todayStats.value.count > 0 ? `今日 ${checkin.todayStats.value.count} 次` : '今日未练'
)

/** 打开打卡浮层：正在训练时先暂停，关闭后保持暂停 */
function openCheckin(tab: 'me' | 'board' = 'me') {
  if (running.value) pause()
  openPanel(tab)
}
</script>

<template>
  <div
    class="app no-scroll"
    :class="{ 'is-pseudo-fullscreen': isPseudoFullscreen }"
    :data-phase="isRest ? 'rest' : 'exercise'"
  >
    <!-- ---------- 顶部状态条 ---------- -->
    <header class="topbar">
      <div class="status-text">
        <span class="dot" />
        <span>{{ statusText }}</span>
      </div>
      <div class="topbar-right">
        <button
          class="today-chip"
          :class="{ on: checkin.hasToday.value }"
          type="button"
          :aria-label="`${todayLabel}，打开打卡记录`"
          @click="openCheckin('me')"
        >
          <span class="today-dot" />
          <span>{{ todayLabel }}</span>
        </button>
        <div class="total-left">{{ totalLeftText }}</div>
      </div>
    </header>

    <!-- ---------- 中间主视觉 ---------- -->
    <section class="stage">
      <div class="stage-main">
        <TrainingRing :ratio="ringRatio" :tag="phaseTag" :countdown="countdownText" />
        <ExerciseFigure :name="actionName" />
      </div>
      <TrainingInfo
        :is-rest="isRest"
        :action-name="actionName"
        :tips="tipsText"
        :breathe="breatheText"
        :next-prefix="nextHint.prefix"
        :next-label="nextHint.label"
      />
    </section>

    <!-- ---------- 底部：进度条 + 控制栏 ---------- -->
    <footer class="bottombar">
      <TrainingProgress :phases="phases" :percent="progressPercent" />
      <TrainingControls
        :running="running"
        :finished="finished"
        :play-label="playLabel"
        :sound-on="soundOn"
        :voice-on="voiceOn"
        :music-on="musicOn"
        @toggle-play="togglePlay"
        @prev="prev"
        @next="next"
        @restart="restart"
        @toggle-sound="toggleSound"
        @toggle-voice="toggleVoice"
        @toggle-music="toggleMusic"
        @toggle-fullscreen="toggleFullscreen"
      />
    </footer>

    <!-- ---------- 完成屏 ---------- -->
    <TrainingFinish
      :show="finished"
      :total-minutes="totalMinutes"
      :today-count="checkin.todayStats.value.count"
      :week-count="checkin.weekCount.value"
      :week-dots="checkin.weekCells.value"
      @restart="restart"
      @open-board="openCheckin('board')"
    />

    <!-- ---------- 打卡浮层 ---------- -->
    <CheckinPanel />
  </div>
</template>

import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  ACTIONS_PER_ROUND,
  CUM_START,
  PHASES,
  PREPARE_SECONDS,
  TOTAL_MINUTES,
  TOTAL_SECONDS,
  clamp,
  formatTime
} from '~/data/training'
import { useAudio } from '~/composables/useAudio'
import { useWakeLock } from '~/composables/useWakeLock'
import { useFullscreen } from '~/composables/useFullscreen'
import { useCheckin } from '~/composables/useCheckin'
import { useUiState } from '~/composables/useUiState'

const REST_TIPS = '喝口水，别坐下'
const REST_BREATHE = '鼻吸口呼，让心率慢慢降下来'

/** 开始动作时的鼓励语（会带上动作名） */
const START_CUES = ['{name}，开始，加油！', '{name}，动起来，你可以的！', '{name}，跟上节奏，走！']
/** 动作过半时的鼓励语 */
const MID_CUES = [
  '很好，保持住！',
  '节奏稳住，呼吸别乱！',
  '做得不错，继续！',
  '核心收紧，加油！'
]
/** 休息阶段的安抚语 */
const REST_CUES = [
  '完成得很棒，休息一分钟，喝口水。',
  '这组漂亮，休息一下，别坐下。',
  '很好，深呼吸，让心率降下来。'
]

/**
 * 训练播放器状态机。
 *
 * 计时只认时间锚点（Date.now - phaseStartTs），不做倒计时递减：
 * 后台/息屏回来一次就能算清跨过多少阶段，不会越走越慢。
 */
export function useTrainingPlayer() {
  const audio = useAudio()
  const wakeLock = useWakeLock()
  const fullscreen = useFullscreen()
  const checkin = useCheckin()
  const ui = useUiState()

  const index = ref(0)
  const running = ref(false)
  const finished = ref(false)
  const started = ref(false)

  /** 当前阶段剩余整秒（只在秒数变化时更新，避免每帧触发文案重渲染） */
  const secLeft = ref(PHASES[0]!.duration)
  /** 当前阶段剩余比例 0-1，每帧更新，仅用于环形进度 */
  const ringRatio = ref(1)

  let phaseStartTs = 0
  let pausedAtTs = 0
  let rafId = 0
  let lastSec = -1
  let lastBeepSec = -1
  let lastTickTs = 0
  let watchdogId: ReturnType<typeof setInterval> | null = null
  /** 本次训练会话的开始时刻（0 表示尚未开始会话） */
  let sessionStartedAt = 0
  /** 本次会话的跳段次数，>0 判定为部分训练 */
  let skipCount = 0
  /** 已播报过的鼓励语（阶段索引 + 秒数），避免暂停/恢复时重复播 */
  const spokenCues = new Set<string>()
  let cueCursor = 0

  /* ------------------------------------------------------------------ 派生状态 */

  const phase = computed(() => PHASES[index.value]!)
  const isRest = computed(() => phase.value.type === 'rest')
  const isPrepare = computed(() => phase.value.type === 'prepare')
  const totalPhases = PHASES.length

  const countdownText = computed(() => formatTime(secLeft.value))

  const elapsedTotal = computed(() =>
    clamp(CUM_START[index.value]! + (phase.value.duration - secLeft.value), 0, TOTAL_SECONDS)
  )

  const totalLeftText = computed(() => `总剩余 ${formatTime(TOTAL_SECONDS - elapsedTotal.value)}`)

  const progressPercent = computed(() =>
    TOTAL_SECONDS > 0 ? (elapsedTotal.value / TOTAL_SECONDS) * 100 : 0
  )

  const statusText = computed(() => {
    const current = phase.value
    if (current.type === 'rest') {
      return `第 ${current.round} 轮 · 休息${current.endsGroup ? '（本轮完成）' : ''}`
    }
    const label = current.type === 'prepare' ? '准备' : '动作'
    return `第 ${current.round} 轮 · ${label} ${current.actionIndex} / ${ACTIONS_PER_ROUND}`
  })

  const actionName = computed(() => (isRest.value ? '休息' : phase.value.exercise!.name))

  const tipsText = computed(() => (isRest.value ? REST_TIPS : phase.value.exercise!.tips))
  const breatheText = computed(() => (isRest.value ? REST_BREATHE : phase.value.exercise!.breathe))
  const phaseTag = computed(() => {
    if (isRest.value) return '休息'
    return isPrepare.value ? '准备' : '动作中'
  })

  const nextHint = computed<{ prefix: string; label: string }>(() => {
    const current = phase.value
    const next = PHASES[index.value + 1]

    if (!next) return { prefix: '接下来：', label: `${TOTAL_MINUTES} 分钟完成` }

    // 准备阶段：动作名已经在主视觉里，这里只提示会自动开始
    if (current.type === 'prepare') {
      return { prefix: '提示：', label: `${PREPARE_SECONDS} 秒后自动开始` }
    }
    // 动作结束后可能接休息，也可能接下一个动作的准备阶段
    if (next.type === 'rest') {
      return { prefix: '下一个：', label: '休息 1 分钟' }
    }
    return {
      prefix: current.type === 'exercise' ? '下一个：' : '接下来：',
      label: next.exercise!.name
    }
  })

  const playLabel = computed(() => {
    if (finished.value) return '开始'
    if (running.value) return '暂停'
    return started.value ? '继续' : '开始'
  })

  /* ------------------------------------------------------------------ 计时核心 */

  function schedule() {
    if (rafId) return
    rafId = requestAnimationFrame(frame)
  }

  function cancelRaf() {
    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = 0
    }
  }

  function frame() {
    rafId = 0
    if (!running.value) return
    tick()
  }

  function tick() {
    if (!running.value) return
    lastTickTs = Date.now()

    const now = Date.now()
    let elapsed = (now - phaseStartTs) / 1000
    let duration = phase.value.duration
    let transitions = 0

    // 相变（含后台回来后的连续追赶）：一次算清，不在中途播放音效
    while (elapsed >= duration) {
      if (index.value >= PHASES.length - 1) {
        finish()
        return
      }
      elapsed -= duration
      index.value += 1
      phaseStartTs = now - elapsed * 1000
      duration = PHASES[index.value]!.duration
      transitions += 1
    }

    if (transitions > 0) {
      enterPhase(transitions === 1)
    }

    renderDynamic(duration - elapsed)
    schedule()
  }

  function renderDynamic(remaining: number) {
    const duration = phase.value.duration
    const left = clamp(remaining, 0, duration)
    const seconds = Math.ceil(left - 0.000001)

    if (seconds !== lastSec) {
      lastSec = seconds
      secLeft.value = seconds
      speakCue(seconds)
    }

    // 环形进度每帧更新，保证视觉连续
    ringRatio.value = duration > 0 ? left / duration : 0

    // 相变前 3 秒：每秒一短促提示音
    if (seconds <= 3 && seconds >= 1 && lastBeepSec !== seconds) {
      lastBeepSec = seconds
      audio.beep(880, 0.09, 0.13)
    }
  }

  /** 轮播鼓励语，避免每次都是同一句 */
  function nextCue(list: string[]): string {
    const text = list[cueCursor % list.length]!
    cueCursor += 1
    return text
  }

  /** 动作进行中的定点鼓励（每个阶段每句只播一次） */
  function speakCue(seconds: number) {
    const current = phase.value
    const key = `${index.value}:${seconds}`
    if (spokenCues.has(key)) return

    if (current.type === 'exercise') {
      if (seconds === 30) {
        spokenCues.add(key)
        audio.speak(nextCue(MID_CUES))
      } else if (seconds === 10) {
        spokenCues.add(key)
        audio.speak('最后十秒，坚持住！')
      }
    } else if (current.type === 'rest' && seconds === 30) {
      spokenCues.add(key)
      audio.speak('恢复得不错，准备下一个动作。')
    }
  }

  function enterPhase(withSound: boolean) {
    lastSec = -1
    lastBeepSec = -1
    spokenCues.clear()
    secLeft.value = phase.value.duration
    ringRatio.value = 1
    if (withSound) {
      audio.chime(phase.value.type)
      speakPhase()
    }
  }

  function speakPhase() {
    const current = phase.value
    if (current.type === 'rest') {
      audio.speak(
        current.endsGroup ? '本轮完成，很棒！休息一分钟，喝口水。' : nextCue(REST_CUES)
      )
    } else if (current.type === 'prepare') {
      // 准备阶段先报动作名，最后 3 秒另有提示音
      audio.speak(`准备，${current.exercise!.name}，五秒后开始`)
    } else {
      audio.speak(nextCue(START_CUES).replace('{name}', current.exercise!.name))
    }
  }

  /* ------------------------------------------------------------------ 播放控制 */

  function resume() {
    if (running.value || finished.value) return
    audio.ensureContext()
    audio.startMusic()

    const fresh = !started.value
    const now = Date.now()

    if (fresh) {
      phaseStartTs = now
      if (sessionStartedAt === 0) {
        sessionStartedAt = now
        skipCount = 0
      }
    } else {
      // 时间锚点补偿：暂停多久就整体后移多久，剩余时间不跳变
      phaseStartTs += now - (pausedAtTs || now)
    }

    pausedAtTs = 0
    started.value = true
    running.value = true
    lastSec = -1
    lastBeepSec = -1
    void wakeLock.request()

    if (fresh) {
      audio.chime(phase.value.type)
      speakPhase()
    }

    tick() // 立刻算一次，不等下一帧
  }

  function pause() {
    if (!running.value) return
    running.value = false
    pausedAtTs = Date.now()
    cancelRaf()
    audio.stopMusic()
    wakeLock.release()
  }

  function togglePlay() {
    if (finished.value) {
      restart()
      return
    }
    if (running.value) pause()
    else resume()
  }

  /** 音乐开关：只在计时中真正启停 */
  function toggleMusic() {
    audio.toggleMusic()
    if (audio.musicOn.value) {
      if (running.value) audio.startMusic()
    } else {
      audio.stopMusic()
    }
  }

  /** 跳到指定阶段：该阶段从整分钟重新计时（点"上一个"即重练这段） */
  function goTo(target: number) {
    const nextIndex = clamp(target, 0, PHASES.length - 1)
    if (sessionStartedAt === 0) sessionStartedAt = Date.now()
    skipCount += 1
    finished.value = false
    index.value = nextIndex
    phaseStartTs = Date.now()
    pausedAtTs = running.value ? 0 : Date.now()
    started.value = true
    lastSec = -1
    lastBeepSec = -1
    secLeft.value = phase.value.duration
    ringRatio.value = 1
    if (running.value) schedule()
  }

  function prev() {
    goTo(index.value - 1)
    if (running.value) speakPhase()
  }

  function next() {
    goTo(index.value + 1)
    if (running.value) speakPhase()
  }

  function restart() {
    audio.cancelSpeech()
    cancelRaf()
    finished.value = false
    running.value = false
    index.value = 0
    started.value = false
    phaseStartTs = 0
    pausedAtTs = 0
    lastSec = -1
    lastBeepSec = -1
    secLeft.value = PHASES[0]!.duration
    ringRatio.value = 1
    resume() // 重播即开始
  }

  function finish() {
    const endedAt = Date.now()
    const startedAt = sessionStartedAt || endedAt - TOTAL_SECONDS * 1000
    const mode = skipCount === 0 ? 'full' : 'partial'

    cancelRaf()
    running.value = false
    finished.value = true
    index.value = PHASES.length - 1
    secLeft.value = 0
    ringRatio.value = 0
    lastSec = 0
    wakeLock.release()
    audio.stopMusic()

    // 每次完成写一条独立记录；sessionStartedAt 归零避免重复写入
    if (sessionStartedAt > 0) {
      checkin.recordSession({ startedAt, endedAt, seconds: TOTAL_SECONDS, mode })
      sessionStartedAt = 0
      skipCount = 0
    }

    audio.celebrate()
  }

  /* ------------------------------------------------------------------ 设备与快捷键 */

  function onKeydown(event: KeyboardEvent) {
    const key = event.key || ''
    const code = event.keyCode || 0

    // 浮层打开时只处理 Esc，训练快捷键全部屏蔽，避免穿透
    if (ui.panelOpen.value) {
      if (key === 'Escape' || code === 27) {
        event.preventDefault()
        ui.closePanel()
      }
      return
    }

    if (key === ' ' || key === 'Spacebar' || code === 32 || key === 'Enter' || code === 13) {
      event.preventDefault()
      togglePlay()
      return
    }
    if (key === 'ArrowLeft' || code === 37) {
      event.preventDefault()
      prev()
      return
    }
    if (key === 'ArrowRight' || code === 39) {
      event.preventDefault()
      next()
      return
    }
    if (key === 'r' || key === 'R' || code === 82) {
      event.preventDefault()
      restart()
      return
    }
    if (key === 'f' || key === 'F' || code === 70) {
      event.preventDefault()
      fullscreen.toggle()
      return
    }
    if (key === 'm' || key === 'M' || code === 77) {
      event.preventDefault()
      audio.toggleSound()
    }
  }

  function onVisibilityChange() {
    if (document.hidden) return
    if (running.value) {
      tick()
      void wakeLock.request()
    }
  }

  function onFullscreenChange() {
    fullscreen.sync()
  }

  function preventTouchMove(event: TouchEvent) {
    const target = event.target as HTMLElement | null
    // 浮层内的可滚动区域放行，页面本身仍然不滚动
    if (target && typeof target.closest === 'function' && target.closest('[data-scroll]')) return
    if (event.cancelable) event.preventDefault()
  }

  function preventGesture(event: Event) {
    event.preventDefault()
  }

  /**
   * 看门狗：部分电视浏览器 / 后台标签页会节流甚至停掉 rAF。
   * 它不参与计时，只发现"距上次 tick 超过 350ms"就强制重算一次。
   */
  function startWatchdog() {
    watchdogId = setInterval(() => {
      if (!running.value) return
      if (Date.now() - lastTickTs > 350) tick()
    }, 400)
  }

  onMounted(() => {
    document.addEventListener('keydown', onKeydown, false)
    document.addEventListener('visibilitychange', onVisibilityChange, false)
    document.addEventListener('fullscreenchange', onFullscreenChange, false)
    document.addEventListener('webkitfullscreenchange', onFullscreenChange, false)
    document.addEventListener('touchmove', preventTouchMove, { passive: false })
    document.addEventListener('gesturestart', preventGesture, false)
    startWatchdog()
  })

  onBeforeUnmount(() => {
    cancelRaf()
    if (watchdogId) clearInterval(watchdogId)
    document.removeEventListener('keydown', onKeydown, false)
    document.removeEventListener('visibilitychange', onVisibilityChange, false)
    document.removeEventListener('fullscreenchange', onFullscreenChange, false)
    document.removeEventListener('webkitfullscreenchange', onFullscreenChange, false)
    document.removeEventListener('touchmove', preventTouchMove)
    document.removeEventListener('gesturestart', preventGesture)
    wakeLock.release()
    audio.dispose()
  })

  return {
    // 状态
    index,
    running,
    finished,
    secLeft,
    ringRatio,
    soundOn: audio.soundOn,
    voiceOn: audio.voiceOn,
    musicOn: audio.musicOn,
    isPseudoFullscreen: fullscreen.isPseudoFullscreen,
    // 派生
    phase,
    isRest,
    phaseTag,
    countdownText,
    statusText,
    actionName,
    tipsText,
    breatheText,
    totalLeftText,
    progressPercent,
    nextHint,
    playLabel,
    phases: PHASES,
    totalPhases,
    totalMinutes: TOTAL_MINUTES,
    totalSeconds: TOTAL_SECONDS,
    // 操作
    togglePlay,
    pause,
    prev,
    next,
    restart,
    toggleSound: audio.toggleSound,
    toggleVoice: audio.toggleVoice,
    toggleMusic,
    toggleFullscreen: fullscreen.toggle
  }
}

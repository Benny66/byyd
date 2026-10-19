import { onMounted, ref } from 'vue'
import type { PhaseType } from '~/data/training'

const STORAGE_KEY = 'beiyun30.v1'

/* --------------------------------------------------------------------------
   运动音乐参数：124 BPM，4 小节循环，全部用振荡器 + 噪声实时合成
   -------------------------------------------------------------------------- */
const MUSIC_BPM = 124
const STEPS_PER_BAR = 8
const BAR_COUNT = 4
const STEP_SECONDS = 60 / MUSIC_BPM / 2 // 八分音符
const MUSIC_LEVEL = 0.32
const MUSIC_DUCKED = 0.09

/** Am - F - C - G，四小节循环 */
const CHORDS = [
  { bass: 110.0, notes: [220.0, 261.63, 329.63] },
  { bass: 87.31, notes: [174.61, 220.0, 261.63] },
  { bass: 130.81, notes: [261.63, 329.63, 392.0] },
  { bass: 98.0, notes: [196.0, 246.94, 293.66] }
]

/**
 * 音频：音乐与提示音全部用 Web Audio API 合成，不依赖任何音频文件。
 * 语音播报走 SpeechSynthesis，播报时自动压低音乐（ducking）。
 */
export function useAudio() {
  const soundOn = ref(true)
  const voiceOn = ref(true)
  const musicOn = ref(true)

  let ctx: AudioContext | null = null
  let musicGain: GainNode | null = null
  let noiseBuffer: AudioBuffer | null = null

  let musicTimer: ReturnType<typeof setInterval> | null = null
  let nextNoteTime = 0
  let stepIndex = 0

  const pendingTimers = new Set<ReturnType<typeof setTimeout>>()
  let duckTimer: ReturnType<typeof setTimeout> | null = null

  function later(fn: () => void, ms: number) {
    const id = setTimeout(() => {
      pendingTimers.delete(id)
      fn()
    }, ms)
    pendingTimers.add(id)
  }

  /** 必须在用户手势里调用（iOS / Safari 的自动播放限制） */
  function ensureContext() {
    if (!import.meta.client) return
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    try {
      if (!ctx) ctx = new Ctor()
      if (ctx.state === 'suspended') void ctx.resume()
    } catch {
      ctx = null
    }
  }

  function ensureMusicGraph(): GainNode | null {
    if (!ctx) return null
    if (!musicGain) {
      musicGain = ctx.createGain()
      musicGain.gain.value = MUSIC_LEVEL
      // 轻压缩，避免鼓点叠加时爆音
      const compressor = ctx.createDynamicsCompressor()
      compressor.threshold.value = -18
      compressor.knee.value = 24
      compressor.ratio.value = 6
      compressor.attack.value = 0.004
      compressor.release.value = 0.2
      musicGain.connect(compressor)
      compressor.connect(ctx.destination)
    }
    if (!noiseBuffer) {
      const length = Math.floor(ctx.sampleRate * 0.2)
      noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate)
      const data = noiseBuffer.getChannelData(0)
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
    }
    return musicGain
  }

  /* ------------------------------------------------------------------ 音色 */

  function kick(t: number, level = 0.55) {
    if (!ctx || !musicGain) return
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(150, t)
    osc.frequency.exponentialRampToValueAtTime(48, t + 0.12)
    gain.gain.setValueAtTime(level, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.17)
    osc.connect(gain)
    gain.connect(musicGain)
    osc.start(t)
    osc.stop(t + 0.2)
  }

  function hat(t: number, level: number) {
    if (!ctx || !musicGain || !noiseBuffer) return
    const source = ctx.createBufferSource()
    source.buffer = noiseBuffer
    const filter = ctx.createBiquadFilter()
    filter.type = 'highpass'
    filter.frequency.value = 7200
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(level, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.045)
    source.connect(filter)
    filter.connect(gain)
    gain.connect(musicGain)
    source.start(t)
    source.stop(t + 0.06)
  }

  function bass(t: number, freq: number) {
    if (!ctx || !musicGain) return
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'triangle'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.001, t)
    gain.gain.exponentialRampToValueAtTime(0.16, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2)
    osc.connect(gain)
    gain.connect(musicGain)
    osc.start(t)
    osc.stop(t + 0.22)
  }

  function pad(t: number, notes: number[], duration: number) {
    if (!ctx || !musicGain) return
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 1400
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.001, t)
    gain.gain.linearRampToValueAtTime(0.028, t + 0.35)
    gain.gain.setValueAtTime(0.028, t + duration - 0.4)
    gain.gain.linearRampToValueAtTime(0.001, t + duration)
    filter.connect(gain)
    gain.connect(musicGain)

    notes.forEach((freq, i) => {
      const osc = ctx!.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = freq
      osc.detune.value = i % 2 === 0 ? -4 : 4
      osc.connect(filter)
      osc.start(t)
      osc.stop(t + duration + 0.05)
    })
  }

  /* ------------------------------------------------------------------ 音乐调度 */

  function scheduleStep(step: number, t: number) {
    const bar = Math.floor(step / STEPS_PER_BAR) % BAR_COUNT
    const beat = step % STEPS_PER_BAR
    const chord = CHORDS[bar]!

    if (beat === 0 || beat === 4) kick(t)
    hat(t, beat % 2 === 0 ? 0.075 : 0.04)
    if (beat === 0 || beat === 3 || beat === 4 || beat === 6) bass(t, chord.bass)
    if (beat === 0) pad(t, chord.notes, STEP_SECONDS * STEPS_PER_BAR)
  }

  function pump() {
    if (!ctx || !musicGain) return
    // 后台标签页被节流后回来：直接跳到当前时刻，避免一次性补几百个音符
    if (nextNoteTime < ctx.currentTime - 0.5) {
      nextNoteTime = ctx.currentTime + 0.05
    }
    while (nextNoteTime < ctx.currentTime + 0.2) {
      scheduleStep(stepIndex, nextNoteTime)
      nextNoteTime += STEP_SECONDS
      stepIndex = (stepIndex + 1) % (STEPS_PER_BAR * BAR_COUNT)
    }
  }

  function startMusic() {
    if (!import.meta.client || !musicOn.value) return
    ensureContext()
    const gain = ensureMusicGraph()
    if (!ctx || !gain) return
    if (musicTimer) return
    gain.gain.cancelScheduledValues(ctx.currentTime)
    gain.gain.setTargetAtTime(MUSIC_LEVEL, ctx.currentTime, 0.2)
    stepIndex = 0
    nextNoteTime = ctx.currentTime + 0.08
    pump()
    musicTimer = setInterval(pump, 40)
  }

  function stopMusic() {
    if (musicTimer) {
      clearInterval(musicTimer)
      musicTimer = null
    }
    if (ctx && musicGain) {
      musicGain.gain.cancelScheduledValues(ctx.currentTime)
      musicGain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.08)
    }
  }

  /* ------------------------------------------------------------------ 提示音 / 语音 */

  /**
   * 合成一个提示音。
   * @param freq 频率 Hz
   * @param dur 时长（秒）
   * @param vol 峰值音量 0-1
   * @param delay 延迟（秒）
   */
  function beep(freq: number, dur: number, vol: number, delay = 0) {
    if (!ctx || !soundOn.value) return
    try {
      const t0 = ctx.currentTime + delay
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, t0)
      gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(t0)
      osc.stop(t0 + dur + 0.03)
    } catch {
      /* 静默失败，不影响计时 */
    }
  }

  /** 相变音：动作开始偏高有力，休息开始偏低柔和，准备阶段用上行短音 */
  function chime(type: PhaseType) {
    if (!soundOn.value) return
    if (type === 'rest') {
      beep(392.0, 0.55, 0.17, 0) // G4
      beep(523.25, 0.6, 0.11, 0.14) // C5
    } else if (type === 'prepare') {
      beep(523.25, 0.22, 0.18, 0) // C5
      beep(659.25, 0.3, 0.16, 0.16) // E5
    } else {
      beep(659.25, 0.36, 0.2, 0) // E5
      beep(987.77, 0.5, 0.14, 0.11) // B5
    }
  }

  /** 完成音：两个上行音 + 鼓励语音 */
  function celebrate() {
    beep(523.25, 0.45, 0.16)
    later(() => beep(783.99, 0.75, 0.15), 200)
    later(() => speak('太棒了，今天完成了，明天同一时间。'), 900)
  }

  /** 语音播报期间压低音乐，结束后恢复 */
  function duck(on: boolean) {
    if (!ctx || !musicGain || !musicTimer) return
    musicGain.gain.cancelScheduledValues(ctx.currentTime)
    musicGain.gain.setTargetAtTime(on ? MUSIC_DUCKED : MUSIC_LEVEL, ctx.currentTime, 0.12)
  }

  function speak(text: string) {
    if (!import.meta.client || !voiceOn.value) return
    if (typeof window.speechSynthesis === 'undefined' || !window.speechSynthesis) return
    if (typeof window.SpeechSynthesisUtterance !== 'function') return
    try {
      window.speechSynthesis.cancel()
      const utterance = new window.SpeechSynthesisUtterance(text)
      utterance.lang = 'zh-CN'
      utterance.rate = 1.02
      utterance.pitch = 1.04
      utterance.volume = 1

      duck(true)
      const restore = () => {
        if (duckTimer) {
          clearTimeout(duckTimer)
          duckTimer = null
        }
        duck(false)
      }
      utterance.onend = restore
      utterance.onerror = restore
      // 部分浏览器不触发 onend，按字数兜底恢复音量
      duckTimer = setTimeout(restore, Math.min(9000, 1400 + text.length * 220))

      window.speechSynthesis.speak(utterance)
    } catch {
      duck(false)
    }
  }

  function cancelSpeech() {
    if (!import.meta.client) return
    if (duckTimer) {
      clearTimeout(duckTimer)
      duckTimer = null
    }
    duck(false)
    if (typeof window.speechSynthesis === 'undefined' || !window.speechSynthesis) return
    try {
      window.speechSynthesis.cancel()
    } catch {
      /* 忽略 */
    }
  }

  /* ------------------------------------------------------------------ 偏好 */

  function persist() {
    if (!import.meta.client) return
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          soundOn: soundOn.value,
          voiceOn: voiceOn.value,
          musicOn: musicOn.value
        })
      )
    } catch {
      /* 忽略 */
    }
  }

  function loadPrefs() {
    if (!import.meta.client) return
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const parsed: unknown = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object') return
      const prefs = parsed as { soundOn?: unknown; voiceOn?: unknown; musicOn?: unknown }
      if (typeof prefs.soundOn === 'boolean') soundOn.value = prefs.soundOn
      if (typeof prefs.voiceOn === 'boolean') voiceOn.value = prefs.voiceOn
      if (typeof prefs.musicOn === 'boolean') musicOn.value = prefs.musicOn
    } catch {
      /* 忽略 */
    }
  }

  function toggleSound() {
    soundOn.value = !soundOn.value
    if (soundOn.value) {
      ensureContext()
      beep(880, 0.1, 0.13)
    } else {
      cancelSpeech()
    }
    persist()
  }

  function toggleVoice() {
    voiceOn.value = !voiceOn.value
    if (voiceOn.value) speak('语音已开启')
    else cancelSpeech()
    persist()
  }

  /** 只切换开关，引擎的启停由播放器根据"是否在计时"决定 */
  function toggleMusic() {
    musicOn.value = !musicOn.value
    if (!musicOn.value) stopMusic()
    persist()
  }

  onMounted(loadPrefs)

  function dispose() {
    stopMusic()
    pendingTimers.forEach((id) => clearTimeout(id))
    pendingTimers.clear()
    if (duckTimer) {
      clearTimeout(duckTimer)
      duckTimer = null
    }
    cancelSpeech()
    try {
      if (ctx && ctx.state !== 'closed') void ctx.close()
    } catch {
      /* 忽略 */
    }
    ctx = null
    musicGain = null
    noiseBuffer = null
  }

  return {
    soundOn,
    voiceOn,
    musicOn,
    ensureContext,
    beep,
    chime,
    celebrate,
    speak,
    cancelSpeech,
    startMusic,
    stopMusic,
    toggleSound,
    toggleVoice,
    toggleMusic,
    dispose
  }
}

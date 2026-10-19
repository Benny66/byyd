<script setup lang="ts">
defineProps<{
  running: boolean
  finished: boolean
  playLabel: string
  soundOn: boolean
  voiceOn: boolean
  musicOn: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle-play'): void
  (e: 'prev'): void
  (e: 'next'): void
  (e: 'restart'): void
  (e: 'toggle-sound'): void
  (e: 'toggle-voice'): void
  (e: 'toggle-music'): void
  (e: 'toggle-fullscreen'): void
}>()
</script>

<template>
  <div class="controls">
    <button class="btn btn-main" type="button" @click="emit('toggle-play')">
      <svg v-if="running" class="ico" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 5h4v14H7zM13 5h4v14h-4z" />
      </svg>
      <svg v-else class="ico" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 5v14l11-7z" />
      </svg>
      <span>{{ playLabel }}</span>
    </button>

    <button class="btn" type="button" @click="emit('prev')">
      <svg class="ico" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 5h2v14H6zM20 5v14l-11-7z" />
      </svg>
      <span>上一个</span>
    </button>

    <button class="btn" type="button" @click="emit('next')">
      <svg class="ico" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M16 5h2v14h-2zM4 5l11 7-11 7z" />
      </svg>
      <span>下一个</span>
    </button>

    <button class="btn" type="button" @click="emit('restart')">
      <svg class="ico" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 4V1L7 6l5 5V6a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z" />
      </svg>
      <span>重播</span>
    </button>

    <button
      class="btn"
      :class="{ off: !musicOn }"
      type="button"
      :aria-pressed="musicOn"
      @click="emit('toggle-music')"
    >
      <svg class="ico" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 18.5a3.5 3.5 0 1 1-2-3.16V5.2L21 2.5v12.66a3.5 3.5 0 1 1-2-3.16V7.2L9 9.2z" />
      </svg>
      <span>音乐 {{ musicOn ? '开' : '关' }}</span>
    </button>

    <button
      class="btn"
      :class="{ off: !soundOn }"
      type="button"
      :aria-pressed="soundOn"
      @click="emit('toggle-sound')"
    >
      <svg class="ico" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 9v6h3.6L13 20V4L7.6 9H4z" />
        <path
          d="M16.2 8.4a5 5 0 0 1 0 7.2"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        />
      </svg>
      <span>声音 {{ soundOn ? '开' : '关' }}</span>
    </button>

    <button
      class="btn"
      :class="{ off: !voiceOn }"
      type="button"
      :aria-pressed="voiceOn"
      @click="emit('toggle-voice')"
    >
      <svg class="ico" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 2.6a3.2 3.2 0 0 1 3.2 3.2v5.4a3.2 3.2 0 0 1-6.4 0V5.8A3.2 3.2 0 0 1 12 2.6zm7 8.6a1 1 0 0 1 1 1 8 8 0 0 1-7 7.94V22h-2v-1.86A8 8 0 0 1 4 12.2a1 1 0 0 1 2 0 6 6 0 0 0 12 0 1 1 0 0 1 1-1z"
        />
      </svg>
      <span>语音 {{ voiceOn ? '开' : '关' }}</span>
    </button>

    <button class="btn" type="button" @click="emit('toggle-fullscreen')">
      <svg class="ico" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M3.5 3.5h7v2.2H5.7v4.8H3.5V3.5zm10 0h7v7h-2.2V5.7h-4.8V3.5zM3.5 13.5h2.2v4.8h4.8v2.2h-7v-7zm14.8 0h2.2v7h-7v-2.2h4.8v-4.8z"
        />
      </svg>
      <span>全屏</span>
    </button>
  </div>
</template>

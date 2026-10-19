import { computed, reactive, ref } from 'vue'
import { api, ApiError } from '~/data/api'
import {
  calendarDays,
  computeStreak,
  dayKey,
  shiftDay,
  todaySessions,
  todayStat,
  weekDays,
  weekValidDays,
  type SessionMode,
  type SessionRecord
} from '~/data/checkin'
import {
  CHECKIN_KEY,
  OUTBOX_KEY,
  PROFILE_KEY,
  createId,
  loadDeviceId,
  loadOutbox,
  loadProfile,
  loadSessions,
  saveOutbox,
  saveProfile,
  saveSessions
} from '~/data/checkin-storage'

export type SyncState = 'idle' | 'syncing' | 'error' | 'offline'

const MAX_OUTBOX = 200
const RETRY_BASE_MS = 1000
const RETRY_MAX_MS = 30_000
const BACKFILL_DAYS = 7

interface SessionInput {
  startedAt: number
  endedAt: number
  seconds: number
  mode: SessionMode
}

const state = reactive({
  hydrated: false,
  sessions: [] as SessionRecord[],
  deviceId: '',
  nickname: '',
  optIn: false,
  syncState: 'idle' as SyncState,
  syncMessage: '',
  lastSyncAt: 0
})

const today = ref(dayKey())

let outbox: SessionRecord[] = []
let flushing = false
let retryTimer: ReturnType<typeof setTimeout> | null = null
let retryDelay = RETRY_BASE_MS
let timersStarted = false

function persistProfile(): void {
  saveProfile({ nickname: state.nickname, optIn: state.optIn })
}

function trimOutbox(): void {
  if (outbox.length > MAX_OUTBOX) outbox.splice(0, outbox.length - MAX_OUTBOX)
}

function refreshToday(): void {
  const next = dayKey()
  if (next === today.value) return
  today.value = next
  if (state.optIn) void flush()
}

function scheduleRetry(): void {
  if (retryTimer) clearTimeout(retryTimer)
  const delay = retryDelay
  retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS)
  retryTimer = setTimeout(() => {
    retryTimer = null
    void flush()
  }, delay)
}

function onStorage(event: StorageEvent): void {
  if (event.key === CHECKIN_KEY) state.sessions = loadSessions()
  if (event.key === PROFILE_KEY) {
    const profile = loadProfile()
    state.nickname = profile.nickname
    state.optIn = profile.optIn
  }
  if (event.key === OUTBOX_KEY) outbox = loadOutbox()
}

/** 首次进入页面时从本地恢复，并开始跨天/联网/多标签页监听 */
function hydrate(): void {
  if (state.hydrated || !import.meta.client) return
  state.sessions = loadSessions()
  state.deviceId = loadDeviceId()
  const profile = loadProfile()
  state.nickname = profile.nickname
  state.optIn = profile.optIn
  outbox = loadOutbox()
  state.hydrated = true
  today.value = dayKey()

  if (!timersStarted) {
    timersStarted = true
    window.setInterval(refreshToday, 60_000)
    window.addEventListener('focus', refreshToday)
    document.addEventListener('visibilitychange', refreshToday)
    window.addEventListener('storage', onStorage)
    window.addEventListener('online', () => {
      state.syncState = 'idle'
      retryDelay = RETRY_BASE_MS
      void flush()
    })
    window.addEventListener('offline', () => {
      state.syncState = 'offline'
    })
  }

  if (state.optIn) void flush()
}

async function ensureDevice(): Promise<void> {
  const device = await api.upsertDevice({
    deviceId: state.deviceId,
    nickname: state.nickname,
    optIn: state.optIn
  })
  state.nickname = device.nickname
}

/** 把积压记录按顺序推到服务端；成功/重复/毒消息都出队，只有网络与 5xx 重试 */
async function flush(): Promise<void> {
  if (!import.meta.client || flushing) return
  if (!state.optIn || !state.nickname) return
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    state.syncState = 'offline'
    return
  }
  if (outbox.length === 0) {
    state.syncState = 'idle'
    return
  }

  flushing = true
  state.syncState = 'syncing'
  state.syncMessage = ''

  try {
    await ensureDevice()

    while (outbox.length > 0) {
      const record = outbox[0]!
      try {
        await api.uploadSession({
          id: record.id,
          deviceId: state.deviceId,
          day: record.day,
          startedAt: record.startedAt,
          endedAt: record.endedAt,
          seconds: record.seconds,
          mode: record.mode
        })
      } catch (error) {
        if (error instanceof ApiError) {
          // 409 视为已存在；其余 4xx 是数据本身的问题，丢弃避免堵住队列
          if (error.status === 409) {
            /* 已存在，继续出队 */
          } else if (error.status >= 400 && error.status < 500) {
            /* 毒消息，丢弃 */
          } else {
            throw error
          }
        } else {
          throw error
        }
      }
      outbox.shift()
      saveOutbox(outbox)
    }

    state.syncState = 'idle'
    state.lastSyncAt = Date.now()
    retryDelay = RETRY_BASE_MS
  } catch (error) {
    state.syncState = 'error'
    state.syncMessage =
      error instanceof ApiError ? error.message : '同步失败，稍后会自动重试'
    scheduleRetry()
  } finally {
    flushing = false
  }
}

/** 写入一条训练记录：本地立即生效，上榜时才进入同步队列 */
function recordSession(input: SessionInput): SessionRecord | null {
  if (!import.meta.client) return null

  const startedAt = Math.max(0, Math.round(input.startedAt))
  const endedAt = Math.max(startedAt, Math.round(input.endedAt))
  const day = dayKey(startedAt)
  const record: SessionRecord = {
    id: createId(),
    day,
    startDay: day,
    startedAt,
    endedAt,
    seconds: Math.max(1, Math.round(input.seconds)),
    mode: input.mode
  }

  state.sessions.push(record)
  saveSessions(state.sessions)
  refreshToday()

  if (state.optIn) {
    outbox.push(record)
    trimOutbox()
    saveOutbox(outbox)
    void flush()
  }

  return record
}

function enqueueRecent(days: number): void {
  const from = shiftDay(today.value, -(days - 1))
  const queued = new Set(outbox.map((item) => item.id))
  const recent = state.sessions
    .filter((item) => item.day >= from && !queued.has(item.id))
    .sort((a, b) => a.endedAt - b.endedAt)
  outbox.push(...recent)
  trimOutbox()
  saveOutbox(outbox)
}

function normalizeNickname(raw: string): string {
  const nickname = raw.trim().replace(/\s+/g, ' ')
  const length = Array.from(nickname).length
  if (length < 1 || length > 16) {
    throw new Error('昵称需要 1–16 个字符')
  }
  return nickname
}

/** 开启上榜：显式同意 + 补传最近 7 天 */
async function enableOptIn(rawNickname: string): Promise<void> {
  const nickname = normalizeNickname(rawNickname)
  const device = await api.upsertDevice({
    deviceId: state.deviceId,
    nickname,
    optIn: true
  })
  state.nickname = device.nickname
  state.optIn = true
  persistProfile()
  enqueueRecent(BACKFILL_DAYS)
  await flush()
}

async function renameNickname(rawNickname: string): Promise<void> {
  const nickname = normalizeNickname(rawNickname)
  if (!state.optIn) {
    state.nickname = nickname
    persistProfile()
    return
  }
  const device = await api.upsertDevice({
    deviceId: state.deviceId,
    nickname,
    optIn: true
  })
  state.nickname = device.nickname
  persistProfile()
}

async function disableOptIn(): Promise<void> {
  if (state.optIn) {
    await api.updateDevice({
      deviceId: state.deviceId,
      nickname: state.nickname,
      optIn: false
    })
  }
  state.optIn = false
  persistProfile()
  outbox = []
  saveOutbox(outbox)
  state.syncState = 'idle'
}

/** 删除服务端上榜数据，本地记录保留 */
async function deleteLeaderboardData(): Promise<void> {
  await api.deleteDevice(state.deviceId)
  state.optIn = false
  persistProfile()
  outbox = []
  saveOutbox(outbox)
  state.syncState = 'idle'
}

const todayKeyValue = computed(() => today.value)
const todayStats = computed(() => todayStat(state.sessions, today.value))
const todayList = computed(() => todaySessions(state.sessions, today.value))
const streak = computed(() => computeStreak(state.sessions, today.value))
const weekCount = computed(() => weekValidDays(state.sessions, today.value))
const calendar = computed(() => calendarDays(state.sessions, today.value))
const weekCells = computed(() => {
  const done = new Set(state.sessions.map((session) => session.day))
  return weekDays(today.value).map((day) => ({ day, done: done.has(day) }))
})
const hasToday = computed(() => todayStats.value.count > 0)
const syncPending = computed(() => state.syncState === 'syncing' || state.syncState === 'error')

export function useCheckin() {
  return {
    state,
    today: todayKeyValue,
    todayStats,
    todayList,
    streak,
    weekCount,
    calendar,
    weekCells,
    hasToday,
    syncPending,
    hydrate,
    recordSession,
    flush,
    enableOptIn,
    renameNickname,
    disableOptIn,
    deleteLeaderboardData,
    refreshToday
  }
}

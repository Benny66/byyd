import { reactive } from 'vue'
import { api, ApiError, type LeaderboardMe, type LeaderboardResponse, type LeaderboardRow } from '~/data/api'
import { BOARD_KEY, readJSON, writeJSON } from '~/data/checkin-storage'
import { useCheckin } from '~/composables/useCheckin'

const CACHE_TTL_MS = 30_000

interface BoardCache {
  version: 1
  cachedAt: number
  data: LeaderboardResponse
}

const state = reactive({
  loaded: false,
  loading: false,
  error: '',
  offline: false,
  rows: [] as LeaderboardRow[],
  me: null as LeaderboardMe | null,
  weekStart: '',
  weekEnd: '',
  updatedAt: 0
})

function apply(response: LeaderboardResponse, cachedAt: number): void {
  state.rows = response.rows ?? []
  state.me = response.me ?? null
  state.weekStart = response.weekStart
  state.weekEnd = response.weekEnd
  state.updatedAt = cachedAt
  state.loaded = true
}

function loadCache(): boolean {
  const cached = readJSON<BoardCache>(BOARD_KEY)
  if (!cached || cached.version !== 1 || !cached.data) return false
  apply(cached.data, cached.cachedAt)
  state.offline = true
  return true
}

function saveCache(response: LeaderboardResponse): void {
  writeJSON(BOARD_KEY, { version: 1, cachedAt: Date.now(), data: response } satisfies BoardCache)
}

async function load(force = false): Promise<void> {
  if (state.loading) return
  if (!force && state.loaded && Date.now() - state.updatedAt < CACHE_TTL_MS) return

  const checkin = useCheckin()
  state.loading = true
  state.error = ''

  try {
    const response = await api.leaderboard(checkin.state.deviceId, 50)
    apply(response, Date.now())
    saveCache(response)
    state.offline = false
  } catch (error) {
    const hasCache = state.loaded || loadCache()
    state.offline = hasCache
    state.error = hasCache
      ? '网络不可用，展示上次缓存'
      : error instanceof ApiError
        ? error.message
        : '排行榜加载失败'
  } finally {
    state.loading = false
  }
}

export function useLeaderboard() {
  return { board: state, load, loadCache }
}

import type { SessionMode } from './checkin'

/** 与前端同源，静态产物和接口由同一个 Go 服务提供 */
const API_BASE = '/api/v1'
const TIMEOUT_MS = 8000

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string }
}

export interface DevicePayload {
  deviceId: string
  nickname: string
  optIn: boolean
}

export interface DeviceResponse {
  deviceId: string
  nickname: string
  optIn: boolean
}

export interface UploadSessionPayload {
  id: string
  deviceId: string
  day: string
  startedAt: number
  endedAt: number
  seconds: number
  mode: SessionMode
}

export interface UploadSessionResponse {
  accepted: boolean
  duplicate: boolean
}

export interface LeaderboardRow {
  rank: number
  nickname: string
  days: number
  minutes: number
  todayCount: number
}

export interface LeaderboardMe {
  rank: number
  days: number
  minutes: number
  todayCount: number
  inTop: boolean
}

export interface LeaderboardResponse {
  weekStart: string
  weekEnd: string
  updatedAt: number
  rows: LeaderboardRow[]
  me: LeaderboardMe | null
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers ?? {})
      },
      signal: controller.signal
    })

    const text = await response.text()
    const body: unknown = text ? JSON.parse(text) : null

    if (!response.ok) {
      const envelope = (body ?? {}) as ErrorEnvelope
      throw new ApiError(
        response.status,
        envelope.error?.code ?? 'http_error',
        envelope.error?.message ?? `请求失败（${response.status}）`
      )
    }
    return body as T
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError(0, 'timeout', '请求超时，请稍后重试')
    }
    throw new ApiError(0, 'network_error', '网络不可用，稍后会自动重试')
  } finally {
    clearTimeout(timer)
  }
}

export const api = {
  upsertDevice(payload: DevicePayload): Promise<DeviceResponse> {
    return request<DeviceResponse>('/devices', {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  },

  updateDevice(payload: DevicePayload): Promise<DeviceResponse> {
    return request<DeviceResponse>(`/devices/${encodeURIComponent(payload.deviceId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ nickname: payload.nickname, optIn: payload.optIn })
    })
  },

  deleteDevice(deviceId: string): Promise<{ deleted: boolean }> {
    return request<{ deleted: boolean }>(`/devices/${encodeURIComponent(deviceId)}`, {
      method: 'DELETE'
    })
  },

  uploadSession(payload: UploadSessionPayload): Promise<UploadSessionResponse> {
    return request<UploadSessionResponse>('/sessions', {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  },

  leaderboard(deviceId: string, limit = 50): Promise<LeaderboardResponse> {
    const query = new URLSearchParams({ limit: String(limit) })
    if (deviceId) query.set('deviceId', deviceId)
    return request<LeaderboardResponse>(`/leaderboard?${query.toString()}`)
  }
}

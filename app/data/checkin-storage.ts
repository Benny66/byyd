import type { SessionRecord, SessionMode } from './checkin'

/** 打卡记录（与声音偏好的 beiyun30.v1 完全隔离，避免旧版本页面整体重写时冲掉记录） */
export const CHECKIN_KEY = 'beiyun30.checkin.v1'
export const DEVICE_KEY = 'beiyun30.device.v1'
export const OUTBOX_KEY = 'beiyun30.outbox.v1'
export const PROFILE_KEY = 'beiyun30.profile.v1'
export const BOARD_KEY = 'beiyun30.board.v1'

export interface CheckinProfile {
  nickname: string
  optIn: boolean
}

interface Envelope<T> {
  version: 1
  data: T
}

function isClient(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

export function readJSON<T>(key: string): T | null {
  if (!isClient()) return null
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function writeJSON(key: string, value: unknown): boolean {
  if (!isClient()) return false
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function removeKey(key: string): void {
  if (!isClient()) return
  try {
    window.localStorage.removeItem(key)
  } catch {
    /* 忽略 */
  }
}

export function createId(): string {
  const cryptoObj = globalThis.crypto
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const rand = (Math.random() * 16) | 0
    const value = char === 'x' ? rand : (rand & 0x3) | 0x8
    return value.toString(16)
  })
}

function isMode(value: unknown): value is SessionMode {
  return value === 'full' || value === 'partial'
}

function isSession(value: unknown): value is SessionRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'string' &&
    record.id.length > 0 &&
    typeof record.day === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(record.day) &&
    typeof record.startDay === 'string' &&
    typeof record.startedAt === 'number' &&
    Number.isFinite(record.startedAt) &&
    typeof record.endedAt === 'number' &&
    Number.isFinite(record.endedAt) &&
    typeof record.seconds === 'number' &&
    Number.isFinite(record.seconds) &&
    isMode(record.mode)
  )
}

function sanitizeSessions(value: unknown): SessionRecord[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const sessions: SessionRecord[] = []
  for (const item of value) {
    if (!isSession(item) || seen.has(item.id)) continue
    seen.add(item.id)
    sessions.push(item)
  }
  return sessions
}

export function loadSessions(): SessionRecord[] {
  const stored = readJSON<Envelope<SessionRecord[]>>(CHECKIN_KEY)
  if (!stored || stored.version !== 1) return []
  return sanitizeSessions(stored.data)
}

export function saveSessions(sessions: readonly SessionRecord[]): void {
  writeJSON(CHECKIN_KEY, {
    version: 1,
    data: sessions
  } satisfies Envelope<readonly SessionRecord[]>)
}

export function loadOutbox(): SessionRecord[] {
  const stored = readJSON<Envelope<SessionRecord[]>>(OUTBOX_KEY)
  if (!stored || stored.version !== 1) return []
  return sanitizeSessions(stored.data)
}

export function saveOutbox(sessions: readonly SessionRecord[]): void {
  writeJSON(OUTBOX_KEY, {
    version: 1,
    data: sessions
  } satisfies Envelope<readonly SessionRecord[]>)
}

export function loadDeviceId(): string {
  const existing = readJSON<string>(DEVICE_KEY)
  if (typeof existing === 'string' && existing.length >= 8 && existing.length <= 64) {
    return existing
  }
  const id = createId()
  writeJSON(DEVICE_KEY, id)
  return id
}

export function loadProfile(): CheckinProfile {
  const stored = readJSON<Partial<CheckinProfile>>(PROFILE_KEY)
  return {
    nickname: typeof stored?.nickname === 'string' ? stored.nickname.slice(0, 16) : '',
    optIn: stored?.optIn === true
  }
}

export function saveProfile(profile: CheckinProfile): void {
  writeJSON(PROFILE_KEY, profile)
}

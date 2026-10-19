/**
 * 打卡记录的数据模型与纯函数。
 *
 * 业务时区固定为 Asia/Shanghai：归属日、周窗口、日历都以它为准，
 * 避免“设备本地时区 + 服务器时区”两套时钟打架。
 */

/** 业务时区 */
export const BUSINESS_TIME_ZONE = 'Asia/Shanghai'

const MS_PER_DAY = 86_400_000

export type SessionMode = 'full' | 'partial'

/** 一次训练记录 */
export interface SessionRecord {
  /** 全局唯一 ID，同时作为服务端幂等键 */
  id: string
  /** 归属日 'YYYY-MM-DD'（取开始日，跨零点归前一天） */
  day: string
  /** 开始日，保留用于展示与排查 */
  startDay: string
  /** 开始时刻 epoch ms */
  startedAt: number
  /** 完成时刻 epoch ms */
  endedAt: number
  /** 实际训练秒数 */
  seconds: number
  /** 完整训练 / 部分训练（发生过跳段） */
  mode: SessionMode
}

export interface DayStat {
  day: string
  /** 当天记录条数 */
  count: number
  /** 当天累计秒数 */
  seconds: number
  /** 当天完整训练条数 */
  fullCount: number
}

export interface CalendarCell {
  day: string
  isToday: boolean
  isFuture: boolean
  hasRecord: boolean
}

export interface TodayStat {
  count: number
  seconds: number
  fullCount: number
}

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
})

const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: BUSINESS_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
})

/** 取某个时刻在业务时区下的日历日 'YYYY-MM-DD' */
export function dayKey(ts: number = Date.now()): string {
  const parts = dayFormatter.formatToParts(new Date(ts))
  const year = parts.find((p) => p.type === 'year')?.value ?? '1970'
  const month = parts.find((p) => p.type === 'month')?.value ?? '01'
  const day = parts.find((p) => p.type === 'day')?.value ?? '01'
  return `${year}-${month}-${day}`
}

/** 业务时区下的 HH:mm */
export function timeLabel(ts: number): string {
  return timeFormatter.format(new Date(ts))
}

/** 'YYYY-MM-DD' → UTC 天序号，用于跨月/跨年/时区安全的天数差 */
export function dayIndex(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  if (!y || !m || !d) return Number.NaN
  return Math.floor(Date.UTC(y, m - 1, d) / MS_PER_DAY)
}

/** UTC 天序号 → 'YYYY-MM-DD' */
export function dayFromIndex(index: number): string {
  const date = new Date(index * MS_PER_DAY)
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 在日期上加减天数 */
export function shiftDay(day: string, delta: number): string {
  return dayFromIndex(dayIndex(day) + delta)
}

/** 两个日期相差的天数（a - b） */
export function diffDays(a: string, b: string): number {
  return dayIndex(a) - dayIndex(b)
}

/** 所在周的周一 */
export function weekStartDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  if (!y || !m || !d) return day
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0=周日
  const offset = (weekday + 6) % 7 // 周一=0
  return shiftDay(day, -offset)
}

/** 本周 7 天（周一 → 周日） */
export function weekDays(day: string): string[] {
  const start = weekStartDay(day)
  return Array.from({ length: 7 }, (_, i) => shiftDay(start, i))
}

/** 按天聚合记录 */
export function aggregateByDay(sessions: readonly SessionRecord[]): Map<string, DayStat> {
  const map = new Map<string, DayStat>()
  for (const session of sessions) {
    const current = map.get(session.day) ?? {
      day: session.day,
      count: 0,
      seconds: 0,
      fullCount: 0
    }
    current.count += 1
    current.seconds += session.seconds
    if (session.mode === 'full') current.fullCount += 1
    map.set(session.day, current)
  }
  return map
}

/** 当天统计 */
export function todayStat(sessions: readonly SessionRecord[], today: string): TodayStat {
  const stat = aggregateByDay(sessions).get(today)
  return {
    count: stat?.count ?? 0,
    seconds: stat?.seconds ?? 0,
    fullCount: stat?.fullCount ?? 0
  }
}

/** 本周有效训练天数（当天至少一次完整训练） */
export function weekValidDays(sessions: readonly SessionRecord[], today: string): number {
  const days = new Set<string>()
  for (const session of sessions) {
    if (session.mode === 'full' && session.day >= weekStartDay(today) && session.day <= shiftDay(weekStartDay(today), 6)) {
      days.add(session.day)
    }
  }
  return days.size
}

/**
 * 连续天数：从最近一个有记录的日期往回数。
 * 今天还没练但昨天练了，仍然显示昨天的连续值；前天之后断档才归零。
 */
export function computeStreak(sessions: readonly SessionRecord[], today: string): number {
  const days = new Set(sessions.map((s) => s.day))
  let cursor = today
  if (!days.has(cursor)) {
    cursor = shiftDay(today, -1)
    if (!days.has(cursor)) return 0
  }
  let streak = 0
  while (days.has(cursor)) {
    streak += 1
    cursor = shiftDay(cursor, -1)
  }
  return streak
}

/** 截至本周的 6 周日历（42 格，周一为首列） */
export function calendarDays(
  sessions: readonly SessionRecord[],
  today: string,
  weeks = 6
): CalendarCell[] {
  const done = new Set(sessions.map((s) => s.day))
  const end = shiftDay(weekStartDay(today), 6)
  const start = shiftDay(end, -(weeks * 7 - 1))
  const cells: CalendarCell[] = []
  for (let i = 0; i < weeks * 7; i += 1) {
    const day = shiftDay(start, i)
    cells.push({
      day,
      isToday: day === today,
      isFuture: day > today,
      hasRecord: done.has(day)
    })
  }
  return cells
}

/** 今日记录，按完成时间倒序 */
export function todaySessions(sessions: readonly SessionRecord[], today: string): SessionRecord[] {
  return sessions
    .filter((s) => s.day === today)
    .slice()
    .sort((a, b) => b.endedAt - a.endedAt)
}

/** 秒数转“N 分钟 / N 小时 M 分” */
export function formatMinutes(seconds: number): string {
  const minutes = Math.max(0, Math.round(seconds / 60))
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分`
}

/** 页面展示用的短时长，32 分钟这种 */
export function formatShortMinutes(seconds: number): string {
  return `${Math.max(0, Math.round(seconds / 60))} 分`
}

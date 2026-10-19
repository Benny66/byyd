import assert from 'node:assert/strict'
import {
  calendarDays,
  computeStreak,
  dayIndex,
  dayKey,
  formatMinutes,
  shiftDay,
  todayStat,
  weekStartDay,
  weekValidDays
} from '../app/data/checkin.ts'

let passed = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    passed += 1
  } catch (error) {
    failures.push({ name, message: error.message })
  }
}

function session(day, { seconds = 1920, mode = 'full', id = `${day}-${Math.random()}` } = {}) {
  return { id, day, startDay: day, startedAt: 0, endedAt: 0, seconds, mode }
}

// 归属日按 Asia/Shanghai（UTC+8），不是 UTC 截断
test('凌晨 UTC 仍算北京当天', () => {
  assert.equal(dayKey(Date.UTC(2026, 9, 18, 23, 50)), '2026-10-19')
})

test('北京 23:59 仍是当天', () => {
  assert.equal(dayKey(Date.UTC(2026, 9, 18, 15, 59)), '2026-10-18')
})

test('跨月加一天', () => {
  assert.equal(shiftDay('2026-09-30', 1), '2026-10-01')
})

test('跨年减一天', () => {
  assert.equal(shiftDay('2026-01-01', -1), '2025-12-31')
})

test('天序号跨月连续', () => {
  assert.equal(dayIndex('2026-10-01') - dayIndex('2026-09-30'), 1)
})

test('周一为周起点', () => {
  assert.equal(weekStartDay('2026-10-19'), '2026-10-19')
  assert.equal(weekStartDay('2026-10-25'), '2026-10-19')
})

test('连续三天', () => {
  const days = [session('2026-10-17'), session('2026-10-18'), session('2026-10-19')]
  assert.equal(computeStreak(days, '2026-10-19'), 3)
})

test('今天未练但昨天练了仍保留连续', () => {
  const days = [session('2026-10-18'), session('2026-10-19')]
  assert.equal(computeStreak(days, '2026-10-20'), 2)
})

test('断签归零', () => {
  const days = [session('2026-10-17'), session('2026-10-18')]
  assert.equal(computeStreak(days, '2026-10-20'), 0)
})

test('空记录连续为 0', () => {
  assert.equal(computeStreak([], '2026-10-19'), 0)
})

test('跨月连续', () => {
  const days = [session('2026-09-30'), session('2026-10-01')]
  assert.equal(computeStreak(days, '2026-10-01'), 2)
})

test('多次训练只算一天', () => {
  const days = [session('2026-10-19', { id: 'a' }), session('2026-10-19', { id: 'b' }), session('2026-10-19', { id: 'c' })]
  assert.equal(computeStreak(days, '2026-10-19'), 1)
})

test('本周天数只算完整训练', () => {
  const days = [
    session('2026-10-12'),
    session('2026-10-19', { id: 'full-1' }),
    session('2026-10-19', { id: 'part-1', mode: 'partial' }),
    session('2026-10-20', { id: 'full-2' })
  ]
  assert.equal(weekValidDays(days, '2026-10-20'), 2)
})

test('今日统计含次数与秒数', () => {
  const days = [
    session('2026-10-19', { id: 'a', seconds: 1920 }),
    session('2026-10-19', { id: 'b', seconds: 1920 })
  ]
  assert.deepEqual(todayStat(days, '2026-10-19'), { count: 2, seconds: 3840, fullCount: 2 })
})

test('日历 42 格且末格是本周日', () => {
  const cells = calendarDays([], '2026-10-19')
  assert.equal(cells.length, 42)
  assert.equal(cells[0].day, '2026-09-14')
  assert.equal(cells[41].day, '2026-10-25')
  assert.equal(cells.find((c) => c.isToday)?.day, '2026-10-19')
  assert.equal(cells.filter((c) => c.isFuture).length, 6)
})

test('日历标记已完成', () => {
  const cells = calendarDays([session('2026-10-18')], '2026-10-19')
  assert.equal(cells.find((c) => c.day === '2026-10-18')?.hasRecord, true)
  assert.equal(cells.find((c) => c.day === '2026-10-17')?.hasRecord, false)
})

test('分钟格式化', () => {
  assert.equal(formatMinutes(1920), '32 分钟')
  assert.equal(formatMinutes(3840), '1 小时 4 分')
  assert.equal(formatMinutes(3600), '1 小时')
})

if (failures.length > 0) {
  console.error(`FAIL ${failures.length} / ${passed + failures.length}`)
  for (const failure of failures) console.error(`- ${failure.name}: ${failure.message}`)
  process.exit(1)
}

console.log(`PASS ${passed}/${passed} checkin-core`)

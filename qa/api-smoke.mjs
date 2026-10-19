// 服务端接口校验：注册、幂等、边界、榜单排序与隐私开关。
// 用法：node qa/api-smoke.mjs [http://127.0.0.1:8787]
const BASE = (process.argv[2] || 'http://127.0.0.1:8787').replace(/\/$/, '')

const failures = []
function check(name, ok, detail) {
  if (!ok) failures.push({ name, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + JSON.stringify(detail)}`)
}

function dayKey(offset = 0) {
  const date = new Date(Date.now() + offset * 86_400_000)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date)
  const get = (type) => parts.find((part) => part.type === type)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

async function request(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  })
  const text = await response.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { status: response.status, body, headers: response.headers }
}

const suffix = Date.now().toString(36)
const deviceA = `dev-qa-a-${suffix}`
const deviceB = `dev-qa-b-${suffix}`
const nameA = `阿甲${suffix.slice(-4)}`
const nameB = `阿乙${suffix.slice(-4)}`

function session(deviceId, day, id, { seconds = 1920, mode = 'full', endedAt = Date.now() } = {}) {
  return {
    id: `sess-${id}-${suffix}`,
    deviceId,
    day,
    startedAt: endedAt - seconds * 1000,
    endedAt,
    seconds,
    mode
  }
}

try {
  let result = await request('/healthz')
  check('健康检查可用', result.status === 200 && result.body.db === 'ok', result.body)

  result = await request('/')
  check('入口页可访问', result.status === 200 && String(result.body).includes('<!DOCTYPE'), result.status)
  result = await request('/some/unknown/path')
  check('未知路径回退入口页', result.status === 200 && String(result.body).includes('<!DOCTYPE'), result.status)
  result = await request('/api/v1/nope')
  check('未知接口返回 404 JSON', result.status === 404 && result.body?.error?.code === 'not_found', result.body)

  result = await request('/api/v1/devices', {
    method: 'POST',
    body: JSON.stringify({ deviceId: deviceA, nickname: nameA, optIn: true })
  })
  check('注册设备 A', result.status === 200 && result.body.nickname === nameA, result.body)

  result = await request('/api/v1/devices', {
    method: 'POST',
    body: JSON.stringify({ deviceId: deviceB, nickname: nameA, optIn: true })
  })
  check('昵称冲突返回 409', result.status === 409 && result.body?.error?.code === 'nickname_taken', result.body)

  result = await request('/api/v1/devices', {
    method: 'POST',
    body: JSON.stringify({ deviceId: deviceB, nickname: nameB, optIn: true })
  })
  check('注册设备 B', result.status === 200, result.body)

  const today = dayKey(0)
  result = await request('/api/v1/sessions', {
    method: 'POST',
    body: JSON.stringify(session(deviceA, today, 'a1'))
  })
  check('上报完整训练', result.status === 201 && result.body.duplicate === false, result.body)

  result = await request('/api/v1/sessions', {
    method: 'POST',
    body: JSON.stringify(session(deviceA, today, 'a1'))
  })
  check('重复上报幂等', result.status === 201 && result.body.duplicate === true, result.body)

  result = await request('/api/v1/sessions', {
    method: 'POST',
    body: JSON.stringify(session(deviceA, today, 'a2', { seconds: 3600 }))
  })
  check('超长记录被拒', result.status === 400 && result.body?.error?.code === 'invalid_seconds', result.body)

  result = await request('/api/v1/sessions', {
    method: 'POST',
    body: JSON.stringify(session(deviceA, dayKey(-8), 'a3'))
  })
  check('过旧日期被拒', result.status === 400 && result.body?.error?.code === 'day_out_of_range', result.body)

  result = await request('/api/v1/sessions', {
    method: 'POST',
    body: JSON.stringify(session(deviceA, dayKey(2), 'a4'))
  })
  check('未来日期被拒', result.status === 400 && result.body?.error?.code === 'day_out_of_range', result.body)

  result = await request('/api/v1/sessions', {
    method: 'POST',
    body: JSON.stringify(session('dev-ghost-0000', today, 'a5'))
  })
  check('未注册设备被拒', result.status === 404 && result.body?.error?.code === 'device_not_found', result.body)

  // 同一天再练两次：只算 1 天，分钟数累加
  await request('/api/v1/sessions', {
    method: 'POST',
    body: JSON.stringify(session(deviceA, today, 'a6', { endedAt: Date.now() - 60_000 }))
  })

  // B 只有一个完整训练日，但分钟数更高（两次）
  await request('/api/v1/sessions', {
    method: 'POST',
    body: JSON.stringify(session(deviceB, today, 'b1'))
  })
  await request('/api/v1/sessions', {
    method: 'POST',
    body: JSON.stringify(session(deviceB, today, 'b2'))
  })
  await request('/api/v1/sessions', {
    method: 'POST',
    body: JSON.stringify(session(deviceB, today, 'b3'))
  })

  result = await request(`/api/v1/leaderboard?deviceId=${deviceA}`)
  check('榜单返回成功', result.status === 200 && Array.isArray(result.body.rows), result.status)
  check('同一天多次只算 1 天', result.body.rows.find((row) => row.nickname === nameA)?.days === 1, result.body.rows)
  check('同日两次训练分钟累加', result.body.rows.find((row) => row.nickname === nameA)?.minutes === 64, result.body.rows)
  check('榜单不含设备标识', !JSON.stringify(result.body).includes(deviceA), result.body)
  check('我的排名可用', result.body.me?.rank >= 1 && result.body.me.inTop === true, result.body.me)

  result = await request('/api/v1/leaderboard?limit=1')
  check('limit 截断为 1 条', result.body.rows.length === 1, result.body.rows.length)

  // 关闭上榜后从榜单消失
  result = await request(`/api/v1/devices/${deviceB}`, {
    method: 'PATCH',
    body: JSON.stringify({ nickname: nameB, optIn: false })
  })
  check('关闭上榜', result.status === 200 && result.body.optIn === false, result.body)

  result = await request('/api/v1/leaderboard?limit=100')
  check('关闭后不出现在榜单', !result.body.rows.some((row) => row.nickname === nameB), result.body.rows)

  // 删除上榜数据
  result = await request(`/api/v1/devices/${deviceA}`, { method: 'DELETE' })
  check('删除设备数据', result.status === 200 && result.body.deleted === true, result.body)

  result = await request('/api/v1/leaderboard?limit=100')
  check('删除后不出现在榜单', !result.body.rows.some((row) => row.nickname === nameA), result.body.rows)
} catch (error) {
  failures.push({ name: 'unexpected', detail: error.message })
  console.error(error)
}

if (failures.length > 0) {
  console.error(`\nFAILED ${failures.length}`)
  process.exit(1)
}
console.log('\nALL PASS')

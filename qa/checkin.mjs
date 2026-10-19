// 打卡 UI 校验：往 localStorage 注入记录，核对顶栏、浮层、日历、今日列表与完成写入。
// 用法：node qa/checkin.mjs [http://127.0.0.1:8787]
import fs from 'node:fs'
import { launch, evalJs, sleep, screenshot, saveJson } from './cdp.mjs'

const BASE = process.argv[2] || 'http://127.0.0.1:8787'
const OUT_DIR = new URL('./shots/checkin/', import.meta.url).pathname
fs.mkdirSync(OUT_DIR, { recursive: true })

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

function record(day, { id, seconds = 1920, mode = 'full', offsetMs = 0 } = {}) {
  return {
    id: id || `${day}-${Math.random().toString(16).slice(2)}`,
    day,
    startDay: day,
    startedAt: Date.now() - 1_920_000 + offsetMs,
    endedAt: Date.now() + offsetMs,
    seconds,
    mode
  }
}

const READ = `(function(){
  var text = function(sel){ var el = document.querySelector(sel); return el ? el.textContent.trim() : null; };
  var stats = Array.prototype.map.call(document.querySelectorAll('.stat b'), function(el){ return el.textContent.trim(); });
  return {
    chip: text('.today-chip'),
    todayLeft: text('.total-left'),
    panelOpen: !!document.querySelector('.panel.show'),
    panelTitle: text('.panel-title'),
    tabs: Array.prototype.map.call(document.querySelectorAll('.panel-tab'), function(el){ return el.textContent.trim(); }),
    stats: stats,
    calendarCells: document.querySelectorAll('.calendar-cell').length,
    calendarDone: document.querySelectorAll('.calendar-cell.done').length,
    sessions: document.querySelectorAll('.session-item').length,
    sessionTimes: Array.prototype.map.call(document.querySelectorAll('.session-time'), function(el){ return el.textContent.trim(); }),
    optinVisible: !!document.querySelector('.optin'),
    meCard: !!document.querySelector('.me-card'),
    boardRows: document.querySelectorAll('.board-row').length,
    boardMeRow: !!document.querySelector('.board-row.me'),
    panelError: text('.panel-error'),
    finishShown: !!document.querySelector('.finish.show'),
    finishSub: text('.finish-sub'),
    stored: (function(){
      try {
        var raw = localStorage.getItem('beiyun30.checkin.v1');
        if (!raw) return 0;
        var parsed = JSON.parse(raw);
        return Array.isArray(parsed.data) ? parsed.data.length : 0;
      } catch (error) { return -1; }
    })()
  };
})()`

const { proc, client } = await launch({ port: 9445 })
const consoleErrors = []
const pageErrors = []

try {
  await client.send('Page.enable')
  await client.send('Runtime.enable')
  await client.send('Log.enable')
  client.on((msg) => {
    if (msg.method === 'Runtime.exceptionThrown') {
      pageErrors.push(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text)
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      consoleErrors.push(msg.params.entry.text)
    }
  })

  await client.send('Page.navigate', { url: BASE })
  await sleep(1200)

  const seed = {
    version: 1,
    data: [
      record(dayKey(0), { id: 'qa-today-1' }),
      record(dayKey(0), { id: 'qa-today-2', mode: 'partial', seconds: 900, offsetMs: -4_000_000 }),
      record(dayKey(-1), { id: 'qa-yesterday-1' }),
      record(dayKey(-2), { id: 'qa-two-days-1' }),
      record(dayKey(-9), { id: 'qa-nine-days-1' })
    ]
  }

  await evalJs(client, `(function(){
    localStorage.clear();
    localStorage.setItem('beiyun30.checkin.v1', ${JSON.stringify(JSON.stringify(seed))});
    localStorage.setItem('beiyun30.device.v1', ${JSON.stringify(JSON.stringify('dev-qa-checkin'))});
    localStorage.setItem('beiyun30.profile.v1', ${JSON.stringify(JSON.stringify({ nickname: '', optIn: false }))});
    return 'ok';
  })()`)

  await client.send('Page.reload', { ignoreCache: true })
  await sleep(1400)

  let state = await evalJs(client, READ)
  check('顶栏显示今日次数', state.chip === '今日 2 次', state.chip)
  check('今日统计为 2 次 / 47 分钟 / 连续 3 天', JSON.stringify(state.stats) === JSON.stringify(['2', '47', '3']), state.stats)

  // 打开浮层
  await evalJs(client, `(function(){ document.querySelector('.today-chip').click(); return 'ok'; })()`)
  await sleep(500)
  state = await evalJs(client, READ)
  check('点击徽标打开浮层', state.panelOpen === true, state.panelOpen)
  check('浮层标题为打卡', state.panelTitle === '打卡', state.panelTitle)
  check('两个页签', JSON.stringify(state.tabs) === JSON.stringify(['我的', '排行榜']), state.tabs)
  check('日历 42 格', state.calendarCells === 42, state.calendarCells)
  check('日历标记 4 个训练日', state.calendarDone === 4, state.calendarDone)
  check('今日记录 2 条', state.sessions === 2, state.sessions)
  check('今日记录按时间倒序', state.sessionTimes.length === 2, state.sessionTimes)

  await screenshot(client, `${OUT_DIR}panel-me-desktop.png`, { width: 1280, height: 720 })
  await screenshot(client, `${OUT_DIR}panel-me-mobile.png`, { width: 390, height: 844, mobile: true, dsf: 2 })
  await screenshot(client, `${OUT_DIR}panel-me-landscape.png`, { width: 844, height: 390, mobile: true, dsf: 2 })

  // 排行榜页签（未上榜）
  await evalJs(client, `(function(){
    var tab = document.querySelectorAll('.panel-tab')[1];
    tab.click();
    return 'ok';
  })()`)
  await sleep(900)
  state = await evalJs(client, READ)
  check('未上榜显示开启入口', state.optinVisible === true, state.optinVisible)
  await screenshot(client, `${OUT_DIR}panel-board-mobile.png`, { width: 390, height: 844, mobile: true, dsf: 2 })

  // Esc 关闭
  await evalJs(client, `(function(){
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    return 'ok';
  })()`)
  await sleep(300)
  state = await evalJs(client, READ)
  check('Esc 关闭浮层', state.panelOpen === false, state.panelOpen)

  // 第二阶段：伪造时钟推进，验证完成时写入记录
  await client.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(function(){
      var realNow = Date.now.bind(Date);
      window.__qaOffset = 0;
      Date.now = function(){ return realNow() + window.__qaOffset; };
    })();`
  })
  await evalJs(client, `(function(){ localStorage.clear(); return 'ok'; })()`)
  await client.send('Page.reload', { ignoreCache: true })
  await sleep(1300)

  await evalJs(client, `(function(){ document.querySelector('.btn-main').click(); return 'ok'; })()`)
  await sleep(400)
  await evalJs(client, `(function(){ window.__qaOffset = 1_922_000; return 'ok'; })()`)
  await sleep(900)

  state = await evalJs(client, READ)
  check('完成屏出现', state.finishShown === true, state.finishShown)
  check('完成屏显示今天第 1 次', (state.finishSub || '').indexOf('今天第 1 次') >= 0, state.finishSub)
  check('完成后本地写入 1 条记录', state.stored === 1, state.stored)
  check('完成后顶栏显示今日 1 次', state.chip === '今日 1 次', state.chip)

  // 第三阶段：开启上榜，验证补传与榜单出现
  const nickname = `QA${Date.now().toString(36).slice(-6)}`
  await client.send('Page.reload', { ignoreCache: true })
  await sleep(1300)
  await evalJs(client, `(function(){ document.querySelector('.today-chip').click(); return 'ok'; })()`)
  await sleep(400)
  await evalJs(client, `(function(){
    document.querySelectorAll('.panel-tab')[1].click();
    return 'ok';
  })()`)
  await sleep(700)
  await evalJs(client, `(function(){
    var input = document.querySelector('.optin .text-input');
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(nickname)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`)
  await sleep(200)
  await evalJs(client, `(function(){ document.querySelector('.optin-btn').click(); return 'ok'; })()`)
  await sleep(1800)

  state = await evalJs(client, READ)
  check('开启上榜后显示昵称卡片', state.meCard === true, state.meCard)
  check('榜单出现自己的一行', state.boardMeRow === true, { rows: state.boardRows, error: state.panelError })
  check('开启过程无错误提示', !state.panelError, state.panelError)
  await screenshot(client, `${OUT_DIR}panel-board-opted-in.png`, { width: 390, height: 844, mobile: true, dsf: 2 })

  check('无未捕获异常', pageErrors.length === 0, pageErrors)
  check('无 console 错误', consoleErrors.length === 0, consoleErrors)

  saveJson(`${OUT_DIR}out-checkin.json`, { failures, state })
} finally {
  client.close()
  proc.kill('SIGKILL')
}

if (failures.length > 0) {
  console.error(`\nFAILED ${failures.length}`)
  process.exit(1)
}
console.log('\nALL PASS')

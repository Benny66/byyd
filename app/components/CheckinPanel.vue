<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useCheckin } from '~/composables/useCheckin'
import { useLeaderboard } from '~/composables/useLeaderboard'
import { useUiState } from '~/composables/useUiState'
import { formatShortMinutes, timeLabel } from '~/data/checkin'

const { panelOpen, panelTab, closePanel } = useUiState()
const checkin = useCheckin()
const { board, load, loadCache } = useLeaderboard()

const weekLabels = ['一', '二', '三', '四', '五', '六', '日']
const nicknameDraft = ref('')
const busy = ref(false)
const errorText = ref('')
const notice = ref('')

const todayMinutes = computed(() => Math.round(checkin.todayStats.value.seconds / 60))
const optedIn = computed(() => checkin.state.optIn)
const myNickname = computed(() => checkin.state.nickname)

const syncText = computed(() => {
  if (!optedIn.value) return ''
  if (checkin.state.syncState === 'syncing') return '同步中…'
  if (checkin.state.syncState === 'offline') return '离线，稍后自动同步'
  if (checkin.state.syncState === 'error') return checkin.state.syncMessage || '同步失败，会自动重试'
  return ''
})

function open(): void {
  nicknameDraft.value = checkin.state.nickname
  errorText.value = ''
  notice.value = ''
  if (checkin.state.optIn) void checkin.flush()
  if (panelTab.value === 'board') void load()
}

watch(panelOpen, (visible) => {
  if (visible) open()
})

watch(panelTab, (tab) => {
  if (tab === 'board' && panelOpen.value) void load()
})

onMounted(() => {
  loadCache()
})

async function enable(): Promise<void> {
  busy.value = true
  errorText.value = ''
  notice.value = ''
  try {
    await checkin.enableOptIn(nicknameDraft.value)
    await load(true)
    notice.value = '已开启上榜，最近 7 天的记录已补传'
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : '开启失败，请稍后重试'
  } finally {
    busy.value = false
  }
}

async function saveNickname(): Promise<void> {
  busy.value = true
  errorText.value = ''
  notice.value = ''
  try {
    await checkin.renameNickname(nicknameDraft.value)
    await load(true)
    notice.value = '昵称已更新'
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : '保存失败，请稍后重试'
  } finally {
    busy.value = false
  }
}

async function disable(): Promise<void> {
  busy.value = true
  errorText.value = ''
  try {
    await checkin.disableOptIn()
    await load(true)
    notice.value = '已关闭上榜，后续训练不再上传'
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : '关闭失败，请稍后重试'
  } finally {
    busy.value = false
  }
}

async function removeData(): Promise<void> {
  if (typeof window !== 'undefined' && !window.confirm('删除上榜数据？本地记录会保留，但榜单上的成绩会消失。')) {
    return
  }
  busy.value = true
  errorText.value = ''
  try {
    await checkin.deleteLeaderboardData()
    await load(true)
    notice.value = '上榜数据已删除'
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : '删除失败，请稍后重试'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div
    class="panel"
    :class="{ show: panelOpen }"
    role="dialog"
    aria-modal="true"
    aria-label="打卡记录与排行榜"
    :aria-hidden="!panelOpen"
  >
    <header class="panel-head">
      <div class="panel-title">打卡</div>
      <button class="panel-close" type="button" aria-label="关闭" @click="closePanel">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </header>

    <div class="panel-tabs" role="tablist" aria-label="打卡视图">
      <button
        class="panel-tab"
        :class="{ on: panelTab === 'me' }"
        type="button"
        role="tab"
        :aria-selected="panelTab === 'me'"
        @click="panelTab = 'me'"
      >
        我的
      </button>
      <button
        class="panel-tab"
        :class="{ on: panelTab === 'board' }"
        type="button"
        role="tab"
        :aria-selected="panelTab === 'board'"
        @click="panelTab = 'board'"
      >
        排行榜
      </button>
    </div>

    <div class="panel-body" data-scroll>
      <template v-if="panelTab === 'me'">
        <div class="stat-row">
          <div class="stat">
            <b>{{ checkin.todayStats.value.count }}</b>
            <span>今日次数</span>
          </div>
          <div class="stat">
            <b>{{ todayMinutes }}</b>
            <span>今日分钟</span>
          </div>
          <div class="stat">
            <b>{{ checkin.streak.value }}</b>
            <span>连续天数</span>
          </div>
        </div>

        <div class="calendar">
          <div class="calendar-head">
            <span v-for="label in weekLabels" :key="label">{{ label }}</span>
          </div>
          <div class="calendar-grid">
            <span
              v-for="cell in checkin.calendar.value"
              :key="cell.day"
              class="calendar-cell"
              :class="{ done: cell.hasRecord, today: cell.isToday, future: cell.isFuture }"
              :title="cell.day"
            />
          </div>
          <div class="calendar-legend">
            <span><i class="dot done" /> 已训练</span>
            <span><i class="dot" /> 未训练</span>
          </div>
        </div>

        <h3 class="panel-section">今日记录</h3>
        <p v-if="syncText" class="panel-hint">{{ syncText }}</p>

        <ul v-if="checkin.todayList.value.length > 0" class="session-list">
          <li v-for="session in checkin.todayList.value" :key="session.id" class="session-item">
            <span class="session-time">{{ timeLabel(session.endedAt) }}</span>
            <span class="session-duration">{{ formatShortMinutes(session.seconds) }}</span>
            <span class="session-mode" :class="{ partial: session.mode === 'partial' }">
              {{ session.mode === 'full' ? '完整' : '部分' }}
            </span>
          </li>
        </ul>
        <div v-else class="panel-empty">今天还没练，练完会自动记一笔。</div>

        <p class="panel-footnote">一天可以练多次，每次都会单独记录；连续天数只看有没有练。</p>
      </template>

      <template v-else>
        <p v-if="board.offline" class="panel-hint warn">
          {{ board.error || '离线，展示上次缓存' }}
          <button class="link" type="button" @click="load(true)">重试</button>
        </p>

        <div v-if="!optedIn" class="optin">
          <p class="optin-title">还没上榜</p>
          <p class="optin-desc">
            开启后，你的昵称、本周训练天数与今日次数会出现在公开榜；备孕话题比较私密，请确认后再开。
          </p>
          <input
            v-model="nicknameDraft"
            class="text-input"
            type="text"
            maxlength="16"
            placeholder="取个昵称（1–16 字）"
            aria-label="昵称"
          />
          <button class="btn btn-main optin-btn" type="button" :disabled="busy" @click="enable">
            {{ busy ? '处理中…' : '开启上榜' }}
          </button>
          <p v-if="errorText" class="panel-error">{{ errorText }}</p>
          <p v-if="notice" class="panel-notice">{{ notice }}</p>
        </div>

        <template v-else>
          <div class="me-card">
            <div>
              <span class="me-label">以</span>
              <b class="me-name">{{ myNickname }}</b>
              <span class="me-label">上榜</span>
            </div>
            <button class="link" type="button" @click="disable">关闭上榜</button>
          </div>

          <div class="rename-row">
            <input
              v-model="nicknameDraft"
              class="text-input"
              type="text"
              maxlength="16"
              placeholder="修改昵称"
              aria-label="修改昵称"
            />
            <button class="btn small" type="button" :disabled="busy" @click="saveNickname">保存</button>
          </div>
          <p v-if="errorText" class="panel-error">{{ errorText }}</p>
          <p v-if="notice" class="panel-notice">{{ notice }}</p>

          <div class="board-head">
            <span class="col-rank">#</span>
            <span class="col-name">昵称</span>
            <span class="col-days">本周</span>
            <span class="col-today">今日</span>
          </div>

          <div v-if="board.loading && !board.loaded" class="panel-empty">加载中…</div>
          <div v-else-if="board.rows.length === 0" class="panel-empty">这周还没人上榜，练完一次就是第一名。</div>
          <ol v-else class="board-list">
            <li
              v-for="row in board.rows"
              :key="`${row.rank}-${row.nickname}`"
              class="board-row"
              :class="{ me: row.nickname === myNickname }"
            >
              <span class="col-rank">{{ row.rank }}</span>
              <span class="col-name">{{ row.nickname }}</span>
              <span class="col-days">{{ row.days }} 天</span>
              <span class="col-today">{{ row.todayCount }} 次</span>
            </li>
          </ol>

          <div v-if="board.me && !board.me.inTop" class="my-rank">
            我的排名 <b>{{ board.me.rank }}</b>
            <span>· 本周 {{ board.me.days }} 天 / {{ board.me.minutes }} 分钟</span>
          </div>

          <p v-if="board.updatedAt" class="panel-footnote">
            数据截至 {{ timeLabel(board.updatedAt) }}，每 30 秒刷新一次。
            <button class="link" type="button" @click="load(true)">刷新</button>
          </p>

          <button class="link danger" type="button" :disabled="busy" @click="removeData">删除我的上榜数据</button>
        </template>
      </template>
    </div>
  </div>
</template>

/**
 * 训练课程数据与时间轴构建。
 *
 * 课程来自 docs/yd.md 的 12 个动作，每个动作 60 秒：
 *   原地碎小步 → 换脚跳 → 高抬腿 → 后踢腿 → 劈砍踢膝 → 胯下击掌
 *   → 半蹲弹震 → 半蹲交替撤步 → 深蹲回环 → 深蹲 → 空手跳绳 → 开合跳
 *
 * 排课规则：
 * - 12 个动作循环 2 轮
 * - 每个动作开始前有 5 秒准备倒计时（独立计时）
 * - 每完成 4 个动作休息 60 秒
 * 合计：24×65 + 6×60 = 1920 秒（32 分钟）
 */

export interface Exercise {
  /** 动作名称，同时用于语音播报 */
  name: string
  /** 动作要点 */
  tips: string
  /** 呼吸提示 */
  breathe: string
}

export type PhaseType = 'prepare' | 'exercise' | 'rest'

export interface Phase {
  type: PhaseType
  /** 秒 */
  duration: number
  /** 准备 / 动作阶段对应的动作；休息阶段为 null */
  exercise: Exercise | null
  /** 第几轮（1 起） */
  round: number
  /** 该动作在本轮中的序号（1 起）；休息阶段沿用刚结束的动作序号 */
  actionIndex: number
  /** 该次休息是否落在本轮最后一个动作之后 */
  endsGroup: boolean
}

/** 单个动作时长（秒） */
export const PHASE_SECONDS = 60

/** 每次动作前的准备倒计时（秒） */
export const PREPARE_SECONDS = 5

/** 休息时长（秒） */
export const REST_SECONDS = 60

/** 每几个动作安排一次休息 */
export const ACTIONS_PER_REST = 4

/** 循环轮数 */
export const ROUNDS = 2

export const EXERCISES: Exercise[] = [
  {
    name: '原地碎小步',
    tips: '小步幅快速交替，前脚掌着地，重心放低，落地要轻',
    breathe: '鼻吸口呼，节奏均匀'
  },
  {
    name: '换脚跳',
    tips: '双脚交替单脚落地，膝盖微屈缓冲，落地无声',
    breathe: '跳起呼气，落地吸气'
  },
  {
    name: '高抬腿',
    tips: '交替抬膝到腰高，上身挺直不后仰，腹部收紧',
    breathe: '抬腿呼气，落腿吸气'
  },
  {
    name: '后踢腿',
    tips: '脚跟向后踢向臀部，大腿保持垂直地面，别塌腰',
    breathe: '自然呼吸，保持节奏'
  },
  {
    name: '劈砍踢膝',
    tips: '双手自上向下劈，同时对侧提膝，腹部发力带动',
    breathe: '劈下呼气，还原吸气'
  },
  {
    name: '胯下击掌',
    tips: '提膝同时双手在胯下击掌，上身略前倾，别弓背',
    breathe: '击掌呼气，落腿吸气'
  },
  {
    name: '半蹲弹震',
    tips: '半蹲位小幅上下弹动，膝盖对准脚尖，幅度小而快',
    breathe: '短促均匀呼吸，不憋气'
  },
  {
    name: '半蹲交替撤步',
    tips: '保持半蹲，左右交替后撤一步再收回，重心始终放低',
    breathe: '撤步吸气，收回呼气'
  },
  {
    name: '深蹲回环',
    tips: '深蹲起身时髋部画圈，动作连贯，膝盖不内扣',
    breathe: '下蹲吸气，起身呼气'
  },
  {
    name: '深蹲',
    tips: '脚与肩同宽，膝盖对准脚尖，蹲到大腿接近平行，起身夹臀',
    breathe: '下蹲吸气，起身呼气'
  },
  {
    name: '空手跳绳',
    tips: '手腕画圈模拟摇绳，前脚掌轻跳，全程落地无声',
    breathe: '轻跳呼气，落地吸气'
  },
  {
    name: '开合跳',
    tips: '跳开时双脚比肩宽、双手上举，落地屈膝缓冲',
    breathe: '打开吸气，合拢呼气'
  }
]

export const ACTIONS_PER_ROUND = EXERCISES.length

/**
 * 构建整条时间轴：准备 5s → 动作 60s → … → 每 4 个动作后休息 60s，
 * 12 个动作为一轮，共 2 轮。
 */
export function buildTimeline(
  exercises: Exercise[],
  rounds: number = ROUNDS,
  perRest: number = ACTIONS_PER_REST
): Phase[] {
  const phases: Phase[] = []

  for (let round = 1; round <= rounds; round++) {
    exercises.forEach((exercise, i) => {
      phases.push({
        type: 'prepare',
        duration: PREPARE_SECONDS,
        exercise,
        round,
        actionIndex: i + 1,
        endsGroup: false
      })
      phases.push({
        type: 'exercise',
        duration: PHASE_SECONDS,
        exercise,
        round,
        actionIndex: i + 1,
        endsGroup: false
      })

      if ((i + 1) % perRest === 0) {
        phases.push({
          type: 'rest',
          duration: REST_SECONDS,
          exercise: null,
          round,
          actionIndex: i + 1,
          // 本轮最后一个动作后的休息 = 本轮结束
          endsGroup: i + 1 === exercises.length
        })
      }
    })
  }

  return phases
}

export const PHASES: Phase[] = buildTimeline(EXERCISES)

/** 每个阶段的累计起始秒数，用于总进度与总剩余 */
export const CUM_START: number[] = (() => {
  let acc = 0
  return PHASES.map((phase) => {
    const start = acc
    acc += phase.duration
    return start
  })
})()

export const TOTAL_SECONDS: number = PHASES.reduce((sum, phase) => sum + phase.duration, 0)

/** 总时长（分钟，向下取整；当前为 32） */
export const TOTAL_MINUTES: number = Math.round(TOTAL_SECONDS / 60)

/** 秒数格式化为 mm:ss（向上取整，与倒计时习惯一致） */
export function formatTime(sec: number): string {
  let s = Math.ceil(sec - 0.000001)
  if (!Number.isFinite(s) || s < 0) {
    s = 0
  }
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m < 10 ? `0${m}` : m}:${r < 10 ? `0${r}` : r}`
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

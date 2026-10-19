<script setup lang="ts">
import { computed } from 'vue'

/**
 * 动作示意图：统一 120×140 线稿，颜色跟随主题变量 --main / --main-soft。
 *
 * 每个动作由 2–3 个关键姿态组成，CSS 逐帧轮播（见 main.css 的 fig-swap-*），
 * 不动 JS 计时器，也不触发 Vue 重渲染。
 *
 * 坐标约定：头 (60,22) r9、颈 y31、站立髋 y78–80、地面线 y126。
 * 下蹲类必须把髋降到 y88–94（头随之下降）+ 膝盖外张到 x≈38/80，否则前视图看起来只是站着。
 * 左右交替类动作的第二帧直接用镜像生成，省一半工作量。
 */
type Item = { d: string; k?: 'accent' | 'arrow' }
type Frame = { head: [number, number]; items: Item[]; mirror?: boolean; shift?: number }

const body = (d: string): Item => ({ d })
const accent = (d: string): Item => ({ d, k: 'accent' })
const arrow = (d: string): Item => ({ d, k: 'arrow' })

/** 左右镜像：x → 120 - x，用于交替类动作的第二帧 */
const flip = (f: Frame): Frame => ({ ...f, mirror: true })

/* ---------------------------------------------------------------- 原地碎小步 */
const MARCH: Frame = {
  head: [60, 22],
  items: [
    body('M60 31 V80'),
    body('M60 45 L49 57 L53 68'),
    body('M60 45 L71 56 L67 67'),
    body('M60 80 L55 103 L54 125'),
    body('M60 80 L68 97 L63 109'),
    arrow('M76 100 h9'),
    arrow('M74 109 h7')
  ]
}

/* ------------------------------------------------------------------ 换脚跳 */
/** 腾空收腿 */
const HOP_AIR: Frame = {
  head: [60, 20],
  items: [
    body('M60 29 V74'),
    body('M60 42 L47 27 L43 13'),
    body('M60 42 L73 27 L77 13'),
    body('M60 74 L55 92 L50 104'),
    body('M60 74 L65 92 L60 101'),
    arrow('M90 100 v-18 m-4 5 l4 -5 l4 5')
  ]
}
/** 落地微屈 */
const HOP_LAND: Frame = {
  head: [60, 24],
  items: [
    body('M60 33 V78'),
    body('M60 46 L48 32 L44 18'),
    body('M60 46 L72 32 L76 18'),
    body('M60 78 L57 100 L56 122'),
    body('M60 78 L63 100 L64 122'),
    arrow('M90 100 v-18 m-4 5 l4 -5 l4 5')
  ]
}

/* ------------------------------------------------------------------ 高抬腿 */
const KNEE_UP: Frame = {
  head: [58, 22],
  items: [
    body('M58 31 V80'),
    body('M58 44 L48 58 L55 66'),
    body('M58 44 L70 56 L62 65'),
    body('M58 80 L56 103 L55 125'),
    body('M58 80 L74 72 L84 88'),
    arrow('M98 64 H86 m6 -4 l-6 4 l6 4')
  ]
}

/* ------------------------------------------------------------------ 后踢腿 */
const HEEL_UP: Frame = {
  head: [63, 22],
  items: [
    body('M63 31 L58 78'),
    body('M63 44 L53 55 L57 66'),
    body('M63 44 L74 53 L69 64'),
    body('M58 78 L55 102 L54 125'),
    body('M58 78 L75 93 L66 79'),
    arrow('M89 103 Q100 90 92 74')
  ]
}

/* -------------------------------------------------------------- 劈砍踢膝 */
const CHOP: Frame = {
  head: [58, 20],
  items: [
    body('M58 29 V78'),
    body('M58 42 L74 31 L84 17'),
    body('M58 42 L46 56 L44 72'),
    body('M58 78 L56 102 L55 125'),
    body('M58 78 L74 72 L82 88'),
    arrow('M98 16 Q106 40 84 56')
  ]
}

/* -------------------------------------------------------------- 胯下击掌 */
const CLAP: Frame = {
  head: [58, 20],
  items: [
    body('M58 29 V78'),
    body('M58 42 L44 58 L58 88'),
    body('M58 44 L40 64 L62 92'),
    body('M58 78 L56 102 L55 125'),
    body('M58 78 L82 78 L86 96'),
    accent('M66 86 l6 -4'),
    accent('M66 96 l7 3')
  ]
}

/* -------------------------------------------------------------- 半蹲弹震 */
const PULSE_LOW: Frame = {
  head: [58, 32],
  items: [
    body('M58 41 V90'),
    body('M58 50 L44 60 L54 70'),
    body('M58 50 L72 60 L62 70'),
    body('M58 90 L42 104 L52 124'),
    body('M58 90 L74 104 L68 124'),
    arrow('M92 52 v-11 m-4 4 l4 -4 l4 4'),
    arrow('M92 62 v11 m-4 -4 l4 4 l4 -4')
  ]
}
const PULSE_HIGH: Frame = {
  head: [58, 26],
  items: [
    body('M58 35 V83'),
    body('M58 44 L43 54 L53 64'),
    body('M58 44 L73 54 L63 64'),
    body('M58 83 L42 98 L52 124'),
    body('M58 83 L74 98 L68 124'),
    arrow('M92 52 v-11 m-4 4 l4 -4 l4 4'),
    arrow('M92 62 v11 m-4 -4 l4 4 l4 -4')
  ]
}

/* ---------------------------------------------------------- 半蹲交替撤步 */
const BACK_STEP: Frame = {
  head: [58, 32],
  items: [
    body('M58 41 V88'),
    body('M58 52 L42 47'),
    body('M58 60 L44 66'),
    body('M58 88 L40 102 L52 124'),
    body('M58 88 L78 96 L94 108'),
    arrow('M100 92 H88 m6 -4 l-6 4 l6 4')
  ]
}

/* -------------------------------------------------------------- 深蹲回环 */
const SQUAT_CIRCLE_BASE: Item[] = [
  body('M56 51 L60 94'),
  body('M60 94 L38 102 L52 124'),
  body('M60 94 L80 102 L68 124'),
  arrow('M96 74 a13 13 0 1 1 -13 -13'),
  arrow('M77 66 l6 -6 l5 7')
]
const CIRCLE_UP: Frame = {
  head: [56, 42],
  items: [body('M56 62 L34 44'), body('M56 70 L40 56'), ...SQUAT_CIRCLE_BASE]
}
const CIRCLE_MID: Frame = {
  head: [56, 42],
  items: [body('M56 62 L32 58'), body('M56 70 L34 68'), ...SQUAT_CIRCLE_BASE]
}
const CIRCLE_DOWN: Frame = {
  head: [56, 42],
  items: [body('M56 62 L38 74'), body('M56 70 L44 84'), ...SQUAT_CIRCLE_BASE]
}

/* -------------------------------------------------------------------- 深蹲 */
const SQUAT_UP_FRAME: Frame = {
  head: [58, 24],
  items: [
    body('M58 33 V80'),
    body('M58 46 L40 44'),
    body('M58 52 L42 56'),
    body('M58 80 L56 103 L55 125'),
    body('M58 80 L64 103 L65 125'),
    arrow('M94 58 v12 m-4 -4 l4 4 l4 -4')
  ]
}
const SQUAT_DOWN_FRAME: Frame = {
  head: [56, 42],
  items: [
    body('M56 51 L60 94'),
    body('M56 62 L32 54'),
    body('M56 70 L32 72'),
    body('M60 94 L38 102 L52 124'),
    body('M60 94 L80 102 L68 124'),
    arrow('M94 58 v12 m-4 -4 l4 4 l4 -4')
  ]
}

/* ---------------------------------------------------------------- 空手跳绳 */
/** 腾空：双脚离地，绳从脚下过 */
const ROPE_UP: Frame = {
  head: [60, 22],
  items: [
    body('M60 31 V76'),
    body('M60 44 L47 57 L45 71'),
    body('M60 44 L73 57 L75 71'),
    body('M60 76 L57 94 L56 106'),
    body('M60 76 L63 94 L64 106'),
    accent('M45 71 C35 104 43 123 60 123 C77 123 85 104 75 71'),
    arrow('M94 96 v-13 m-4 4 l4 -4 l4 4')
  ]
}
/** 落地：屈膝缓冲，绳荡到最低点 */
const ROPE_DOWN: Frame = {
  head: [60, 26],
  items: [
    body('M60 35 V82'),
    body('M60 48 L47 62 L45 76'),
    body('M60 48 L73 62 L75 76'),
    body('M60 82 L57 102 L56 118'),
    body('M60 82 L63 102 L64 118'),
    accent('M45 76 C36 108 44 126 60 126 C76 126 84 108 75 76'),
    arrow('M94 96 v-13 m-4 4 l4 -4 l4 4')
  ]
}

/* ------------------------------------------------------------------ 开合跳 */
const JACK_CLOSED: Frame = {
  head: [60, 24],
  items: [
    body('M60 33 V80'),
    body('M60 46 L56 64 L54 78'),
    body('M60 46 L64 64 L66 78'),
    body('M60 80 L57 102 L56 124'),
    body('M60 80 L63 102 L64 124'),
    arrow('M28 94 H16 m6 -4 l-6 4 l6 4'),
    arrow('M92 94 H104 m-6 -4 l6 4 l-6 4')
  ]
}
const JACK_OPEN: Frame = {
  head: [60, 20],
  items: [
    body('M60 29 V78'),
    body('M60 42 L44 28 L38 13'),
    body('M60 42 L76 28 L82 13'),
    body('M60 78 L44 100 L36 124'),
    body('M60 78 L76 100 L84 124'),
    arrow('M28 94 H16 m6 -4 l-6 4 l6 4'),
    arrow('M92 94 H104 m-6 -4 l6 4 l-6 4')
  ]
}

/* -------------------------------------------------------------------- 休息 */
const REST_A: Frame = {
  head: [60, 24],
  items: [
    body('M60 33 V82'),
    body('M60 46 L46 60 L53 78'),
    body('M60 46 L74 60 L67 78'),
    body('M60 82 L57 104 L56 125'),
    body('M60 82 L63 104 L64 125'),
    accent('M84 22 q7 8 0 16'),
    accent('M90 17 q10 11 0 23')
  ]
}
const REST_B: Frame = {
  head: [60, 22],
  items: [
    body('M60 31 V82'),
    body('M60 44 L45 58 L52 76'),
    body('M60 44 L75 58 L68 76'),
    body('M60 82 L57 104 L56 125'),
    body('M60 82 L63 104 L64 125'),
    accent('M82 17 q9 10 0 20'),
    accent('M89 12 q12 13 0 26')
  ]
}

const POSES: Record<string, Frame[]> = {
  原地碎小步: [MARCH, flip(MARCH)],
  换脚跳: [HOP_AIR, HOP_LAND],
  高抬腿: [KNEE_UP, flip(KNEE_UP)],
  后踢腿: [HEEL_UP, flip(HEEL_UP)],
  劈砍踢膝: [CHOP, flip(CHOP)],
  胯下击掌: [CLAP, flip(CLAP)],
  半蹲弹震: [PULSE_LOW, PULSE_HIGH],
  半蹲交替撤步: [BACK_STEP, flip(BACK_STEP)],
  深蹲回环: [CIRCLE_UP, CIRCLE_MID, CIRCLE_DOWN],
  深蹲: [SQUAT_UP_FRAME, SQUAT_DOWN_FRAME],
  空手跳绳: [ROPE_UP, ROPE_DOWN],
  开合跳: [JACK_CLOSED, JACK_OPEN],
  休息: [REST_A, REST_B]
}

const props = defineProps<{ name: string }>()

const frames = computed<Frame[]>(() => POSES[props.name] ?? POSES['休息']!)

/** 镜像帧靠 transform 复用同一份路径，shift 用于"落地"这类整体位移 */
function frameTransform(f: Frame): string | undefined {
  const parts: string[] = []
  if (f.shift) parts.push(`translate(0 ${f.shift})`)
  if (f.mirror) parts.push('translate(120 0) scale(-1 1)')
  return parts.length ? parts.join(' ') : undefined
}
</script>

<template>
  <div class="figure" aria-hidden="true">
    <svg viewBox="0 0 120 140" focusable="false">
      <circle class="halo" cx="60" cy="74" r="54" />
      <line class="ground" x1="14" y1="126" x2="106" y2="126" />
      <g class="frames" :data-n="frames.length">
        <g v-for="(frame, i) in frames" :key="i" class="frame">
          <g :transform="frameTransform(frame)">
            <circle class="head" :cx="frame.head[0]" :cy="frame.head[1]" r="9" />
            <path v-for="(item, j) in frame.items" :key="j" :class="item.k" :d="item.d" />
          </g>
        </g>
      </g>
    </svg>
  </div>
</template>

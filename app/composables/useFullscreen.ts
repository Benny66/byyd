import { ref } from 'vue'

type FsElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void
  msRequestFullscreen?: () => Promise<void> | void
}

type FsDocument = Document & {
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void> | void
  msFullscreenElement?: Element | null
  msExitFullscreen?: () => Promise<void> | void
}

/**
 * 全屏：标准 API → webkit → 伪全屏（隐藏版本号 + 收窄内边距）。
 * 任何一步失败都不报错，直接降级。
 */
export function useFullscreen() {
  const isPseudoFullscreen = ref(false)

  function nativeElement(): Element | null {
    if (!import.meta.client) return null
    const doc = document as FsDocument
    return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? doc.msFullscreenElement ?? null
  }

  function toggle() {
    if (!import.meta.client) return
    const doc = document as FsDocument
    const el = document.documentElement as FsElement

    if (nativeElement()) {
      isPseudoFullscreen.value = false
      if (doc.exitFullscreen) {
        doc.exitFullscreen().catch(() => {})
      } else if (doc.webkitExitFullscreen) {
        doc.webkitExitFullscreen()
      } else if (doc.msExitFullscreen) {
        doc.msExitFullscreen()
      }
      return
    }

    let pending: Promise<void> | null = null
    try {
      const result: unknown = el.requestFullscreen
        ? el.requestFullscreen()
        : el.webkitRequestFullscreen
          ? el.webkitRequestFullscreen()
          : el.msRequestFullscreen
            ? el.msRequestFullscreen()
            : null
      if (result && typeof (result as Promise<void>).then === 'function') {
        pending = result as Promise<void>
      }
    } catch {
      pending = null
    }

    if (pending) {
      pending.then(
        () => {
          isPseudoFullscreen.value = false
        },
        () => {
          isPseudoFullscreen.value = true
        }
      )
    } else {
      // 老浏览器没有返回 Promise：直接切伪全屏兜底
      isPseudoFullscreen.value = !isPseudoFullscreen.value
    }
  }

  /** 浏览器退出原生全屏时同步伪全屏状态 */
  function sync() {
    if (!import.meta.client) return
    if (!nativeElement()) isPseudoFullscreen.value = false
  }

  return { isPseudoFullscreen, toggle, sync }
}

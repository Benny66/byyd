import { onBeforeUnmount, shallowRef } from 'vue'

interface WakeLockSentinelLike {
  release: () => Promise<void> | void
  addEventListener?: (type: string, listener: () => void) => void
}

interface WakeLockLike {
  request: (type: 'screen') => Promise<WakeLockSentinelLike>
}

/** 训练期间阻止屏幕自动熄灭，不支持时静默降级 */
export function useWakeLock() {
  const sentinel = shallowRef<WakeLockSentinelLike | null>(null)

  async function request() {
    if (!import.meta.client) return
    const wakeLock = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock
    if (!wakeLock || typeof wakeLock.request !== 'function') return
    try {
      const lock = await wakeLock.request('screen')
      sentinel.value = lock
      lock.addEventListener?.('release', () => {
        sentinel.value = null
      })
    } catch {
      /* 静默降级 */
    }
  }

  function release() {
    try {
      void sentinel.value?.release()
    } catch {
      /* 忽略 */
    }
    sentinel.value = null
  }

  onBeforeUnmount(release)

  return { request, release }
}

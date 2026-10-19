import { ref } from 'vue'

export type PanelTab = 'me' | 'board'

/**
 * 全局 UI 状态：浮层由播放器（键盘屏蔽）与页面（打开/暂停）共用，
 * 放在模块级 ref 里，避免两处各持一份状态。
 */
const panelOpen = ref(false)
const panelTab = ref<PanelTab>('me')

export function useUiState() {
  function openPanel(tab: PanelTab = 'me'): void {
    panelTab.value = tab
    panelOpen.value = true
  }

  function closePanel(): void {
    panelOpen.value = false
  }

  return { panelOpen, panelTab, openPanel, closePanel }
}

import { create } from 'zustand'

/**
 * 首页「热榜设置」弹层的开关。
 *
 * 原本弹层只在头部按钮里就地开关；页脚的「共 N 个数据源」也要能打开它，
 * 所以把开关提到 store，Modal 改为受控。
 */
interface HotSettingsState {
  open: boolean
  setOpen: (open: boolean) => void
  openSettings: () => void
}

export const useHotSettingsStore = create<HotSettingsState>(set => ({
  open: false,
  setOpen: open => set({ open }),
  openSettings: () => set({ open: true }),
}))

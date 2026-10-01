/*
 * @Description: 「用 App 打开」提示的全局状态（移动端点击链接时触发）
 */
import { create } from 'zustand'

export interface AppOpenTarget {
  /** 浏览器地址（回落用） */
  url: string
  /** App 名（提示文案用） */
  appName: string
  /** 要去唤起的 scheme 地址 */
  href: string
}

interface AppOpenState {
  target: AppOpenTarget | null
  /** 唤起过但页面还可见（大概率没装 App）时的提示态 */
  failed: boolean
  /** 首次询问（失败态会被清掉） */
  open: (target: AppOpenTarget) => void
  /** 唤起过但没跳走（多半没装 App）——直接以失败态展示 */
  openFailed: (target: AppOpenTarget) => void
  markFailed: () => void
  close: () => void
}

export const useAppOpenStore = create<AppOpenState>(set => ({
  target: null,
  failed: false,
  open: target => set({ target, failed: false }),
  openFailed: target => set({ target, failed: true }),
  markFailed: () => set({ failed: true }),
  close: () => set({ target: null, failed: false }),
}))

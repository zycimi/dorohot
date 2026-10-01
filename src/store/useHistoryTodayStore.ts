import { create } from 'zustand'

import { RESPONSE } from '@/enums'

import type { HotListItem, IResponse } from '@/types'

/**
 * 「历史上的今天」共享数据源。
 *
 * 头部中央与页脚日期都要用到当天事件；抽到 store 后只请求一次，
 * 且状态（loading / ready / error）在多个入口间共享。
 */
interface HistoryTodayState {
  list: HotListItem[]
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** 幂等加载：loading / ready 时直接返回，不重复请求 */
  load: () => void
}

export const useHistoryTodayStore = create<HistoryTodayState>((set, get) => ({
  list: [],
  status: 'idle',
  load: () => {
    const status = get().status
    if (status === 'loading' || status === 'ready')
      return
    set({ status: 'loading' })
    fetch('/api/history-today')
      .then(res => res.json() as Promise<IResponse>)
      .then((json) => {
        if (json.code === RESPONSE.SUCCESS && Array.isArray(json.data) && json.data.length)
          set({ list: json.data, status: 'ready' })
        else
          set({ status: 'error' })
      })
      .catch(() => set({ status: 'error' }))
  },
}))

/*
 * @Description: AI 历史记录（服务端）读取 hook
 *
 * 记录由各生成路由自动写入 `/api/ai/history`，前端只读 + 删除。
 * 注意：类型在此**单独定义**，不能从 `@/lib/ai-history` 导入——那个模块依赖 node:fs，
 * 会被打进客户端 bundle 而报错。
 */
'use client'

import type { AiHistoryTokens } from '@/lib/ai-client'
import { useCallback, useEffect, useState } from 'react'

export type AiFeature = 'item' | 'summary' | 'briefing' | 'analyze'

export interface AiHistoryEntry {
  id: string
  feature: AiFeature
  at: number
  label: string
  text?: string
  rows?: { title: string, summary: string, url?: string }[]
  note?: string
  tokens?: AiHistoryTokens
}

interface UseHistoryResult {
  entries: AiHistoryEntry[]
  reload: () => Promise<void>
  remove: (id: string) => Promise<void>
  clear: () => Promise<void>
}

export function useHistory(feature: AiFeature): UseHistoryResult {
  const [entries, setEntries] = useState<AiHistoryEntry[]>([])

  const reload = useCallback(async () => {
    try {
      const response = await fetch(`/api/ai/history?feature=${feature}`, { cache: 'no-store' })
      const json = await response.json()
      setEntries(Array.isArray(json?.data) ? json.data : [])
    }
    catch {
      // 历史只是辅助信息，读取失败不影响主流程
    }
  }, [feature])

  useEffect(() => {
    void reload()
  }, [reload])

  const remove = useCallback(async (id: string) => {
    try {
      await fetch(`/api/ai/history?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    }
    finally {
      await reload()
    }
  }, [reload])

  const clear = useCallback(async () => {
    try {
      await fetch(`/api/ai/history?feature=${feature}`, { method: 'DELETE' })
    }
    finally {
      await reload()
    }
  }, [feature, reload])

  return { entries, reload, remove, clear }
}

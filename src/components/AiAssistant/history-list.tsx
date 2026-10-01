/*
 * @Description: AI 历史记录列表（各功能标签页内复用）
 *
 * 数据来自服务端 `/api/ai/history`，多浏览器共享。时间用手写格式化而非 toLocaleString，
 * 保证输出稳定、不受运行环境影响。
 */
'use client'

import { useState } from 'react'

import type { AiHistoryEntry } from './use-history'

const pad = (n: number) => String(n).padStart(2, '0')

export function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

interface Props {
  entries: AiHistoryEntry[]
  onPick: (entry: AiHistoryEntry) => void
  onRemove: (id: string) => void
  onClear: () => void
}

export default function HistoryList({ entries, onPick, onRemove, onClear }: Props) {
  const [open, setOpen] = useState(false)

  if (!entries.length)
    return null

  return (
    <div className="ai-hist">
      <button type="button" className="ai-hist-toggle" onClick={() => setOpen(v => !v)}>
        {open ? '▾' : '▸'} 历史记录（{entries.length} 条，服务端保存）
      </button>

      {open && (
        <div className="ai-hist-list">
          {entries.map(entry => (
            <div key={entry.id} className="ai-hist-row">
              <button
                type="button"
                className="ai-hist-main"
                onClick={() => onPick(entry)}
                title="载入这次的结果"
              >
                <span className="ai-hist-time">{formatTime(entry.at)}</span>
                <span className="ai-hist-label">
                  {entry.label}
                  {!!entry.tokens?.totalTokens && (
                    <span className="ai-hist-tokens">（消耗 token: {entry.tokens.totalTokens.toLocaleString('en-US')}）</span>
                  )}
                </span>
                {entry.note && <span className="ai-hist-note">{entry.note}</span>}
              </button>
              <button
                type="button"
                className="ai-btn ghost danger mini"
                onClick={() => onRemove(entry.id)}
                title="删除这条记录"
              >
                删除
              </button>
            </div>
          ))}
          <button type="button" className="ai-btn mini" onClick={onClear}>清空本类历史</button>
        </div>
      )}
    </div>
  )
}

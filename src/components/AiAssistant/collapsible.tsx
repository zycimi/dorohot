/*
 * @Description: 生成内容的展开 / 收起（结果区与历史载入的内容共用）
 *
 * 阈值判断用**字符数**而非测量高度：AI 输出长短差异极大，字符数足够可靠且无需布局测量
 * （也就不会在隐藏标签页里量出 0 而误判）。短内容完全不出现按钮。
 */
'use client'

import { useState } from 'react'

import type { ReactNode } from 'react'

/** 超过这个字符数才折叠 */
const THRESHOLD = 600

interface Props {
  /** 用于判断是否折叠的文本（通常是结果的原始文本） */
  text: string
  children: ReactNode
}

export default function Collapsible({ text, children }: Props) {
  const [open, setOpen] = useState(false)
  const needsToggle = (text || '').length > THRESHOLD

  if (!needsToggle)
    return <>{children}</>

  return (
    <div className="ai-collapse">
      <div className={open ? '' : 'ai-collapse-closed'}>{children}</div>
      <button type="button" className="ai-btn mini ai-collapse-btn" onClick={() => setOpen(v => !v)}>
        {open ? '收起' : `展开全部（共 ${text.length} 字）`}
      </button>
    </div>
  )
}

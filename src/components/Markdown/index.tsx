/*
 * @Description: 轻量 Markdown 渲染（AI 输出专用）
 *
 * 为什么不装 react-markdown：本项目要打包分发、依赖越少越好，而 AI 提示词产出的语法是可枚举的小子集。
 * 支持：### 标题、**粗体**、`代码`、~~删除线~~、[文字](链接)、- 无序 / 1. 有序列表、> 引用、
 *      GFM 表格（| 表头 | / | --- |）、``` 代码块、--- 分隔线。
 *
 * 安全性：解析结果直接构造 React 元素，**不使用 dangerouslySetInnerHTML**，
 * 因此模型输出里的 HTML/脚本不会被当作标记执行；链接只允许 http/https/mailto，其余按纯文本渲染。
 */
import { useMemo } from 'react'

import type { ReactNode } from 'react'

/** 行内语法：**粗体** / `代码` / ~~删除线~~ / [文字](链接) */
const INLINE_PATTERN = /(\*\*[^*]+\*\*|`[^`]+`|~~[^~]+~~|\[[^\]]+\]\([^)\s]+\))/g

/** 只允许安全协议，避免 javascript: 之类被当作链接 */
function safeHref(raw: string): string | null {
  try {
    const url = new URL(raw, 'https://example.invalid')
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:')
      return raw
    return null
  }
  catch {
    return null
  }
}

function parseInline(text: string, prefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let cursor = 0
  let match: RegExpExecArray | null
  let index = 0
  INLINE_PATTERN.lastIndex = 0

  while ((match = INLINE_PATTERN.exec(text)) !== null) {
    if (match.index > cursor)
      nodes.push(text.slice(cursor, match.index))

    const token = match[0]
    if (token.startsWith('**')) {
      nodes.push(<strong key={`${prefix}-b${index++}`}>{token.slice(2, -2)}</strong>)
    }
    else if (token.startsWith('`')) {
      nodes.push(<code key={`${prefix}-c${index++}`}>{token.slice(1, -1)}</code>)
    }
    else if (token.startsWith('~~')) {
      nodes.push(<del key={`${prefix}-d${index++}`}>{token.slice(2, -2)}</del>)
    }
    else {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token)
      const label = link?.[1] ?? token
      const href = link ? safeHref(link[2]) : null
      nodes.push(href
        ? <a key={`${prefix}-a${index++}`} href={href} target="_blank" rel="noopener noreferrer">{label}</a>
        : <span key={`${prefix}-t${index++}`}>{label}</span>)
    }

    cursor = match.index + token.length
  }

  if (cursor < text.length)
    nodes.push(text.slice(cursor))

  return nodes
}

/** 表格分隔行：| --- | :--: | 之类 */
function isTableDelimiter(line: string): boolean {
  const cells = splitRow(line)
  return cells.length > 0 && cells.every(cell => /^:?-{2,}:?$/.test(cell.trim()))
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(cell => cell.trim())
}

function isTableRow(line: string): boolean {
  // 允许省略首尾竖线的 GFM 写法；真正判定为表格还要求下一行是分隔行
  return line.includes('|')
}

function renderTable(header: string[], rows: string[][], key: number): ReactNode {
  const head = header.map((cell, i) => <th key={i}>{parseInline(cell, `th${key}-${i}`)}</th>)
  const body = rows.map((row, r) => (
    <tr key={r}>
      {header.map((_, c) => <td key={c}>{parseInline(row[c] ?? '', `td${key}-${r}-${c}`)}</td>)}
    </tr>
  ))
  return (
    <div className="ai-md-table-wrap" key={`table${key}`}>
      <table className="ai-md-table">
        <thead><tr>{head}</tr></thead>
        <tbody>{body}</tbody>
      </table>
    </div>
  )
}

function parseBlocks(text: string): ReactNode[] {
  const lines = (text || '').replace(/\r\n/g, '\n').split('\n')
  const out: ReactNode[] = []
  let key = 0
  let list: { ordered: boolean, items: string[] } | null = null

  const flushList = () => {
    if (!list)
      return
    const items = list.items.map((item, i) => <li key={i}>{parseInline(item, `li${key}-${i}`)}</li>)
    out.push(list.ordered
      ? <ol key={`list${key++}`}>{items}</ol>
      : <ul key={`list${key++}`}>{items}</ul>)
    list = null
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s+$/, '')

    if (!line.trim()) {
      flushList()
      continue
    }

    // ``` 代码块：直到闭合的 ```
    const fence = /^\s*```/.exec(line)
    if (fence) {
      flushList()
      const code: string[] = []
      let j = i + 1
      for (; j < lines.length; j++) {
        if (/^\s*```/.test(lines[j]))
          break
        code.push(lines[j])
      }
      i = j
      out.push(<pre key={`pre${key++}`}><code>{code.join('\n')}</code></pre>)
      continue
    }

    // 分隔线
    if (/^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushList()
      out.push(<hr key={`hr${key++}`} />)
      continue
    }

    // GFM 表格：当前行是表格行，且下一行是分隔行
    if (isTableRow(line) && i + 1 < lines.length && isTableDelimiter(lines[i + 1])) {
      flushList()
      const header = splitRow(line)
      const rows: string[][] = []
      let j = i + 2
      for (; j < lines.length; j++) {
        if (!isTableRow(lines[j]))
          break
        rows.push(splitRow(lines[j]))
      }
      i = j - 1
      out.push(renderTable(header, rows, key++))
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flushList()
      // 模型常用 ###；+2 映射到 h5，避免在卡片里层级过大
      const Tag = `h${Math.min(heading[1].length + 2, 6)}` as 'h3' | 'h4' | 'h5' | 'h6'
      out.push(<Tag key={`h${key++}`}>{parseInline(heading[2], `h${key}`)}</Tag>)
      continue
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line)
    if (bullet) {
      if (!list || list.ordered) {
        flushList()
        list = { ordered: false, items: [] }
      }
      list.items.push(bullet[1])
      continue
    }

    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (ordered) {
      if (!list || !list.ordered) {
        flushList()
        list = { ordered: true, items: [] }
      }
      list.items.push(ordered[1])
      continue
    }

    const quote = /^\s*>\s?(.*)$/.exec(line)
    if (quote) {
      flushList()
      out.push(<blockquote key={`q${key++}`}>{parseInline(quote[1], `q${key}`)}</blockquote>)
      continue
    }

    flushList()
    out.push(<p key={`p${key++}`}>{parseInline(line, `p${key}`)}</p>)
  }

  flushList()
  return out
}

export default function Markdown({ text, className = '' }: { text: string, className?: string }) {
  const blocks = useMemo(() => parseBlocks(text), [text])
  return <div className={`ai-md ${className}`.trim()}>{blocks}</div>
}

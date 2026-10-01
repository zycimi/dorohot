import type { HotListItem } from '@/types'

/** 「历史上的今天」事件列表（头部抽屉与页脚抽屉共用） */
export default function HistoryList({ list }: { list: HotListItem[] }) {
  return (
    <ul className="history-list">
      {list.map(item => (
        <li key={item.id}>
          <a
            className="history-item"
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="history-item-year">{item.tip}年</span>
            <span className="history-item-title">{item.title}</span>
          </a>
        </li>
      ))}
    </ul>
  )
}

/*
 * @Description: 页脚「历史上的今天」入口（仅手机显示）。
 *   手机端头部会隐藏日期/历史，这里用今日日期作按钮，点开当天全部事件。
 *   与头部共用 useHistoryTodayStore，不重复请求。
 */
'use client'
import { useEffect, useMemo, useState } from 'react'

import HistoryDrawer from './drawer'

import TodayDate from '@/components/TodayDate'
import { useHistoryTodayStore } from '@/store/useHistoryTodayStore'

export default function HistoryTodayEntry() {
  const [open, setOpen] = useState(false)
  const list = useHistoryTodayStore(state => state.list)
  const load = useHistoryTodayStore(state => state.load)

  useEffect(() => {
    load()
  }, [load])

  const dateLabel = useMemo(() => `${new Date().getMonth() + 1}月${new Date().getDate()}日`, [])

  return (
    <>
      <button
        type="button"
        aria-label="查看历史上的今天"
        className="text-xs text-default-500 hover:text-accent transition-colors cursor-pointer"
        onClick={() => setOpen(true)}
      >
        <TodayDate />
      </button>
      <HistoryDrawer open={open} onOpenChange={setOpen} list={list} dateLabel={dateLabel} />
    </>
  )
}

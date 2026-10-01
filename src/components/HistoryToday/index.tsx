/*
 * @Author: 白雾茫茫丶<baiwumm.com>
 * @Date: 2026-09-28 09:00:00
 * @LastEditors: opencode
 * @LastEditTime: 2026-09-28 18:30:00
 * @Description: 顶部中央-历史上的今天（轮播 + 手动切换 + 查看全部）
 *
 * 2026-09-28 优化：
 *  - 年份做成胶囊，事件更易扫读；
 *  - 增加「上一条 / 下一条」与 `n/总数` 计数，不必等自动轮播；
 *  - 悬停 / 键盘聚焦时暂停自动轮播；
 *  - 点标题打开抽屉看当天全部事件（抽屉与页脚共用）；
 *  - 尊重 prefers-reduced-motion；
 *  - 数据来自 useHistoryTodayStore（与页脚共用，只请求一次）。
 */
'use client'
import { Description } from '@heroui/react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import HistoryDrawer from './drawer'

import { useHistoryTodayStore } from '@/store/useHistoryTodayStore'

/** 单条事件的停留时长 */
const ROTATE_MS = 7000

const HistoryToday = () => {
  const reduce = useReducedMotion() ?? false
  const list = useHistoryTodayStore(state => state.list)
  const status = useHistoryTodayStore(state => state.status)
  const load = useHistoryTodayStore(state => state.load)
  const [index, setIndex] = useState(0)
  const [open, setOpen] = useState(false)
  const pausedRef = useRef(false)

  // 首次挂载触发一次加载（store 内幂等，页脚也会触发）
  useEffect(() => {
    load()
  }, [load])

  // 自动轮播；减少动效 / 单条 / 悬停暂停时不走
  useEffect(() => {
    if (reduce || list.length <= 1)
      return
    const timer = setInterval(() => {
      if (pausedRef.current)
        return
      setIndex(i => (i + 1) % list.length)
    }, ROTATE_MS)
    return () => clearInterval(timer)
  }, [list.length, reduce])

  const step = useCallback((delta: number) => {
    setIndex((i) => {
      if (!list.length)
        return i
      return (i + delta + list.length) % list.length
    })
  }, [list.length])

  const current = list.length ? list[index % list.length] : undefined
  const dateLabel = useMemo(() => `${new Date().getMonth() + 1}月${new Date().getDate()}日`, [])

  return (
    <div
      className="history-today justify-self-center hidden sm:flex flex-col gap-0.5 text-center min-w-0 max-w-[38rem]"
      onMouseEnter={() => { pausedRef.current = true }}
      onMouseLeave={() => { pausedRef.current = false }}
      onFocusCapture={() => { pausedRef.current = true }}
      onBlurCapture={() => { pausedRef.current = false }}
    >
      <div className="history-head">
        <button type="button" className="history-label" onClick={() => setOpen(true)}>
          历史上的今天
        </button>
        {list.length > 1 && (
          <span className="history-controls">
            <button type="button" aria-label="上一条" className="history-nav-btn" onClick={() => step(-1)}>‹</button>
            <span className="history-counter">{index + 1}/{list.length}</span>
            <button type="button" aria-label="下一条" className="history-nav-btn" onClick={() => step(1)}>›</button>
          </span>
        )}
      </div>

      <div className="history-eventwrap">
        {status === 'loading' && <span className="history-skeleton" aria-hidden="true" />}
        {status === 'error' && <Description className="text-xs">暂无数据</Description>}
        {current && (
          <AnimatePresence mode="wait">
            <motion.div
              key={current.id}
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, y: -6 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className="min-w-0"
            >
              <a
                href={current.url}
                target="_blank"
                rel="noopener noreferrer"
                title={current.title}
                className="history-event"
              >
                <span className="history-year">{current.tip}年</span>
                <span className="history-title">{current.title}</span>
              </a>
            </motion.div>
          </AnimatePresence>
        )}
      </div>

      <HistoryDrawer open={open} onOpenChange={setOpen} list={list} dateLabel={dateLabel} />
    </div>
  )
}

export default HistoryToday

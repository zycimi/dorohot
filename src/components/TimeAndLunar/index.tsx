/*
 * @Author: 白雾茫茫丶<baiwumm.com>
 * @Date: 2026-01-05 09:13:12
 * @LastEditors: 白雾茫茫丶<baiwumm.com>
 * @LastEditTime: 2026-07-31 17:29:46
 * @Description: 日期时间
 */
import { Description } from '@heroui/react'
import NumberFlow, { NumberFlowGroup } from '@number-flow/react'
import dayjs from 'dayjs'
import { Lunar } from 'lunar-typescript'
import { memo, useEffect, useState } from 'react'

import type { FC } from 'react'

const TimeAndLunar: FC = memo(() => {
  const [now, setNow] = useState(() => new Date())
  const [lunar, setLunar] = useState('')
  // number-flow 的交叉淡出动画依赖 @property + mix-blend-mode: plus-lighter；
  // 不支持的内核（部分国产浏览器/旧 Chromium）会把绝对定位的动画副本
  // 以不透明状态叠着渲染，表现为文字重叠 —— 此时退回普通文本时钟。
  const [flowSupported, setFlowSupported] = useState(true)

  useEffect(() => {
    const ok =
      typeof CSS !== 'undefined' &&
      'registerProperty' in CSS &&
      CSS.supports?.('mix-blend-mode', 'plus-lighter')
    if (!ok) setFlowSupported(false)
  }, [])

  useEffect(() => {
    let lastDate = ''

    const update = () => {
      const current = new Date()
      setNow(current)

      const dateStr = dayjs(current).format('YYYY-MM-DD')
      if (dateStr !== lastDate) {
        lastDate = dateStr

        const l = Lunar.fromDate(current)
        setLunar(
          `${l.getYearInGanZhi()}年 ${l.getMonthInGanZhi()}月 ${l.getDayInGanZhi()}日 ${l.getMonthInChinese()}月${l.getDayInChinese()} 星期${l.getWeekInChinese()}`,
        )
      }
    }

    update()
    // 250ms 间隔足够刷新秒位显示，无需 rAF 每帧重渲染
    const timer = setInterval(update, 250)
    return () => clearInterval(timer)
  }, [])

  const d = now

  return (
    <div className="justify-self-center hidden sm:flex flex-col gap-1 text-center whitespace-nowrap">
      {/* 数字流时间（旧内核退回普通文本，避免动画副本叠影） */}
      {flowSupported ? (
        <NumberFlowGroup>
          <div className="flex items-center justify-center text-sm">
            <NumberFlow format={{ useGrouping: false }} value={d.getFullYear()} />
            <NumberFlow format={{ minimumIntegerDigits: 2 }} prefix="-" value={d.getMonth() + 1} />
            <NumberFlow format={{ minimumIntegerDigits: 2 }} prefix="-" value={d.getDate()} />
            <span className="mx-1 whitespace-pre"> </span>
            <NumberFlow format={{ minimumIntegerDigits: 2 }} value={d.getHours()} />
            <NumberFlow format={{ minimumIntegerDigits: 2 }} prefix=":" value={d.getMinutes()} />
            <NumberFlow format={{ minimumIntegerDigits: 2 }} prefix=":" value={d.getSeconds()} />
          </div>
        </NumberFlowGroup>
      ) : (
        <div className="text-sm tabular-nums">{dayjs(d).format('YYYY-MM-DD HH:mm:ss')}</div>
      )}
      {/* 农历 */}
      <Description>{lunar || '加载农历中...'}</Description>
    </div>
  )
})

export default TimeAndLunar

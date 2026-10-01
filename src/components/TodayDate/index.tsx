/*
 * @Author: 白雾茫茫丶<baiwumm.com>
 * @Date: 2026-09-28 09:00:00
 * @LastEditors: opencode
 * @LastEditTime: 2026-09-28 09:00:00
 * @Description: 顶部副标题-今日日期（公历 + 农历 + 星期）
 */
'use client'
import { Lunar } from 'lunar-typescript'
import { useEffect, useState } from 'react'

/**
 * 生成副标题文案，例如「今天是2026年9月28日 农历八月十八 星期一」。
 * 农历通过 lunar-typescript 计算，避免手工维护。
 */
function todayText(d: Date): string {
  const l = Lunar.fromDate(d)
  return `今天是${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 农历${l.getMonthInChinese()}月${l.getDayInChinese()} 星期${l.getWeekInChinese()}`
}

const TodayDate = () => {
  // 初始为空、挂载后再计算：服务端渲染与客户端可能处于不同时区/时刻，
  // 直接在这里 new Date() 会造成 hydration 文案不一致。
  const [text, setText] = useState('')

  useEffect(() => {
    const sync = () =>
      setText((prev) => {
        const next = todayText(new Date())
        return next === prev ? prev : next
      })
    sync()
    // 每分钟检查一次，跨零点后自动更新为新的一天
    const timer = setInterval(sync, 60 * 1000)
    return () => clearInterval(timer)
  }, [])

  // 空字符串用不换行空格占位，避免加载瞬间行高塌陷
  return <>{text || '\u00A0'}</>
}

export default TodayDate

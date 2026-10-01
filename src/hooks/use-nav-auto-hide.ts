/*
 * @Description: 「滚动时自动收起 Header / 数据源导航」的统一实现（2026-09-24）
 *
 * 为什么收成一个 hook：
 *   原来 Header 和 SourceNav 各自挂了一个 window scroll 监听、各写一套 class
 *   （body.nav-auto-hidden 与 nav.is-scrolling），两套样式互相覆盖，
 *   同一个导航会同时吃到两组不同的隐藏规则（一组改 top、一组改 transform）。
 *   现在**只有一个** scroll 监听、只写 body 上的一个 class，隐藏效果全部由 CSS 承担。
 *
 * 隐藏只使用 opacity / transform（见 ai.css）：
 *   两者都不参与布局计算，所以收起/恢复前后占位与实际几何尺寸完全一致，
 *   热榜卡片不会因为导航收起而跳动。
 */
'use client'
import { useEffect } from 'react'

/** 挂在 <body> 上的 class：CSS 据此淡出 Header / 源导航 / 设置页侧导航 */
export const NAV_AUTO_HIDE_CLASS = 'nav-auto-hidden'

/** 停止滚动后恢复显示的延时（计划要求 280–350ms） */
const RESUME_DELAY = 300

export function useNavAutoHide() {
  useEffect(() => {
    // window.setTimeout（而不是全局 setTimeout）：返回确定的 number，便于跨 dom/node 类型判定
    let timer: number | null = null

    const onScroll = () => {
      document.body.classList.add(NAV_AUTO_HIDE_CLASS)
      if (timer !== null)
        window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = null
        document.body.classList.remove(NAV_AUTO_HIDE_CLASS)
      }, RESUME_DELAY)
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (timer !== null)
        window.clearTimeout(timer)
      document.body.classList.remove(NAV_AUTO_HIDE_CLASS)
    }
  }, [])
}

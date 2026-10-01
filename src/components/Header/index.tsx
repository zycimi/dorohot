/*
 * @Author: 白雾茫茫丶<baiwumm.com>
 * @Date: 2025-11-19 17:52:08
 * @LastEditors: 白雾茫茫丶<baiwumm.com>
 * @LastEditTime: 2026-07-31 17:18:38
 * @Description: 顶部布局
 */
'use client'
import { Gear, Shield } from '@gravity-ui/icons'
import { Button, Description, Tooltip } from '@heroui/react'
import Image from 'next/image'
import NextLink from 'next/link'
import { useRouter } from 'next/navigation'
import { useLayoutEffect, useRef } from 'react'

import HistoryToday from '@/components/HistoryToday'
import HotSettings from '@/components/HotSettings'
import ThemeSwitcher from '@/components/ThemeSwitcher'
import TodayDate from '@/components/TodayDate'
import { useNavAutoHide } from '@/hooks/use-nav-auto-hide'

export default function Header() {
  const router = useRouter()
  const headerRef = useRef<HTMLDivElement>(null)

  // 滚动隐藏：全局唯一的 scroll 监听（见 use-nav-auto-hide 的说明）
  useNavAutoHide()

  /**
   * 把 Header 的实际高度写到 `--site-header-h`，供 CSS 计算吸顶偏移
   * （源导航条的 `top`、左右侧栏的 `max-height`、底栏留白）。
   *
   * 为什么不让 CSS 硬编码：Header 是「手机 py-3 / ≥640px p-4」的两套内边距，
   * 里面还有会换行的描述文字，写死的常量一旦和实际高度不符，
   * 源导航就会在吸顶瞬间跳一下（此前 60px 的常量与实际值不符）。
   */
  useLayoutEffect(() => {
    const el = headerRef.current
    if (!el)
      return
    const sync = () => {
      const h = Math.round(el.getBoundingClientRect().height)
      document.documentElement.style.setProperty('--site-header-h', `${h}px`)
    }
    sync()
    // 断点切换、字体加载完成都可能改变高度
    const observer = new ResizeObserver(sync)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    // bg-background/80：原来只有 backdrop-blur 没有底色，滚动时条目会从半透明头部"糊"过去
    // 手机端栅格用「标题列可压缩 + 图标列按内容宽度」：
    // 右侧图标比较多，固定 grid-cols-2 会让图标行超出所在列、压到标题上
    // （320px 实测重叠 19px）。minmax(0,1fr) 让标题列可收缩（配合 h1 的 truncate）。
    <div ref={headerRef} className="site-header w-full max-w-[1800px] mx-auto shrink-0 sticky top-0 z-20 backdrop-blur-sm bg-background/80 px-4 py-3 sm:p-4 grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-3 items-center gap-2">
      <div className="flex gap-2 items-center justify-self-start min-w-0">
        <div className="size-8 sm:size-9 relative shrink-0">
          <Image alt="doroHot 热榜聚合 Logo" fill src="/logo.svg" />
        </div>
        <div className="min-w-0">
          <h1 className="font-black text-lg sm:text-xl min-w-0 truncate">
            {/* 用链接而非 onClick：保留中键/右键新标签打开的浏览器行为；h1 本身与 class 不变。
                链接用 block 撑满 h1 —— 否则可点区域只有文字本身，点标题右侧空白处不会跳转。 */}
            <NextLink
              href="/"
              className="block transition-opacity hover:opacity-70"
            aria-label={`返回首页 - ${process.env.NEXT_PUBLIC_APP_NAME}`}
            >
              {process.env.NEXT_PUBLIC_APP_NAME}
            </NextLink>
          </h1>
          {/* 副标题：由站点口号改为当日日期（公历 + 农历 + 星期），见 TodayDate */}
          <Description className="mt-0.5 hidden sm:block"><TodayDate /></Description>
        </div>
      </div>
      {/* 中央：历史上的今天（原为实时日期/时钟，日期已移到副标题） */}
      <HistoryToday />
      <div className="flex gap-0.5 sm:gap-1 justify-self-end">
        {/* 热榜设置 */}
        <Tooltip delay={0}>
          <Tooltip.Trigger aria-label="热榜设置">
            <HotSettings />
          </Tooltip.Trigger>
          <Tooltip.Content showArrow>
            <Tooltip.Arrow />
            热榜设置
          </Tooltip.Content>
        </Tooltip>

        {/* 主题切换按钮 */}
        <Tooltip delay={0}>
          <Tooltip.Trigger aria-label="主题切换">
            <ThemeSwitcher />
          </Tooltip.Trigger>
          <Tooltip.Content showArrow>
            <Tooltip.Arrow />
            主题切换
          </Tooltip.Content>
        </Tooltip>
        {/* 管理后台（首页公开；此处入口，未登录会跳登录页） */}
        <Tooltip delay={0}>
          <Button
            aria-label="管理后台"
            size="sm"
            variant="ghost"
            isIconOnly
            onPress={() => router.push('/admin')}
          >
            <Shield />
          </Button>
          <Tooltip.Content showArrow>
            <Tooltip.Arrow />
            管理后台
          </Tooltip.Content>
        </Tooltip>
        {/* 设置（原 AI 助手入口；AI 助手已改为首页右下角悬浮气泡） */}
        <Tooltip delay={0}>
          <Button
            aria-label="设置"
            size="sm"
            variant="ghost"
            isIconOnly
            onPress={() => router.push('/settings')}
          >
            <Gear />
          </Button>
          <Tooltip.Content showArrow>
            <Tooltip.Arrow />
            设置
          </Tooltip.Content>
        </Tooltip>

      </div>
    </div>
  )
}

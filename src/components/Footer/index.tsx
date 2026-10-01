/*
 * @Author: 白雾茫茫丶<baiwumm.com>
 * @Date: 2025-11-20 09:43:44
 * @LastEditors: 白雾茫茫丶<baiwumm.com>
 * @LastEditTime: 2026-07-31 17:18:59
 * @Description: 底部版权
 */
'use client'
import { Chip, cn, Description, Link, Separator } from '@heroui/react'
import Image from 'next/image'
import NextLink from 'next/link'

import HistoryTodayEntry from '@/components/HistoryToday/footer-entry'
import { useDeviceKind } from '@/hooks/use-device-kind'
import { useAppStore } from '@/store/useAppStore'
import { useHotSettingsStore } from '@/store/useHotSettingsStore'

import type { ReactNode } from 'react'

interface Social {
  icon?: ReactNode
  image?: string
  url: string
  label: string
}

export default function Footer() {
  // 备案信息。env 未配置时 label 为空 —— 不能再渲染「无文字的碎图标」，先过滤掉。
  const IcpLinks: Social[] = [
    {
      image: '/icp.png',
      url: 'https://beian.miit.gov.cn/#/Integrated/index',
      label: process.env.NEXT_PUBLIC_ICP || '',
    },
    {
      image: '/gongan.png',
      url: 'https://beian.mps.gov.cn/#/query/webSearch',
      label: process.env.NEXT_PUBLIC_GONGAN || '',
    },
  ].filter(item => item.label)

  // 「共 N 个数据源」按当前设备统计可见源（与首页网格口径一致）
  const device = useDeviceKind()
  const desktop = useAppStore(state => state.desktop)
  const mobile = useAppStore(state => state.mobile)
  const { sortItems, hiddenItems } = device === 'mobile' ? mobile : desktop
  const hiddenSet = new Set(hiddenItems ?? [])
  const sourceCount = sortItems.filter(value => !hiddenSet.has(value)).length
  const openSettings = useHotSettingsStore(state => state.openSettings)

  return (
    <footer className="w-full max-w-[1800px] mx-auto shrink-0 px-6 sm:pr-16 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] border-t border-separator grid grid-cols-1 sm:grid-cols-2 items-center gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0 justify-self-center sm:justify-self-start">
        <div className="flex items-center gap-2">
          <div className="size-5 relative">
            <Image alt="doroHot 热榜聚合 Logo" fill src="/logo.svg" />
          </div>
          <span className="text-sm font-bold">
            {process.env.NEXT_PUBLIC_APP_NAME}
          </span>
        </div>
        <Separator orientation="vertical" className="h-4 self-center" />
        <Chip
          color="success"
          size="sm"
          variant="soft"
          className="px-2 py-0.5 text-[10px]"
        >
          <div
            data-slot="status-indicator"
            className={cn(
              'relative flex size-2 shrink-0 rounded-full bg-success',
              'before:absolute before:inset-0 before:animate-ping before:rounded-full before:bg-inherit',
              'after:absolute after:inset-0.5 after:rounded-full after:bg-inherit',
            )}
          />
          <Chip.Label>服务状态正常</Chip.Label>
        </Chip>
        <Separator orientation="vertical" className="h-4 self-center" />
        <NextLink
          href="/cookies"
          className="text-xs text-default-500 hover:text-accent transition-colors"
        >
          Cookies 管理
        </NextLink>
        <Separator orientation="vertical" className="h-4 self-center" />
        <NextLink
          href="/settings"
          className="text-xs text-default-500 hover:text-accent transition-colors"
        >
          设置
        </NextLink>
        <Separator orientation="vertical" className="h-4 self-center" />
        <NextLink
          href="/admin"
          className="text-xs text-default-500 hover:text-accent transition-colors"
        >
          后台
        </NextLink>
      </div>
      <div className="flex gap-x-3 gap-y-1 items-center flex-col sm:flex-row justify-self-center sm:justify-self-end">
        <button
          type="button"
          onClick={openSettings}
          title={`当前显示 ${sourceCount} / 共 ${sortItems.length} 个数据源，点击打开热榜设置`}
          className="whitespace-nowrap text-xs text-default-500 hover:text-accent transition-colors cursor-pointer"
        >
          共
          {' '}
          {sourceCount}
          {' '}
          个数据源
        </button>
        {IcpLinks.length > 0 && (
          <>
            <Separator orientation="vertical" className="hidden sm:block h-4 self-center" />
            {IcpLinks.map(({ image, url, label }) => (
              <Link
                key={url}
                href={url}
                target="_blank"
                aria-label={label}
                className="flex gap-1 items-center no-underline"
              >
                <Image
                  alt={label}
                  height={14}
                  src={image!}
                  width={14}
                />
                <Description className="hover:text-accent transition-colors">
                  {label}
                </Description>
              </Link>
            ))}
          </>
        )}
      </div>

      {/* 手机端（<640px）头部隐藏了日期/历史，这里补上今日日期，点开可看全部历史事件 */}
      <div className="sm:hidden justify-self-center">
        <HistoryTodayEntry />
      </div>
    </footer>
  )
}

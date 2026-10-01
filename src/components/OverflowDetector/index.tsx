/*
 * @Author: 白雾茫茫丶<baiwumm.com>
 * @Date: 2025-11-20 14:36:58
 * @LastEditors: 白雾茫茫丶<baiwumm.com>
 * @LastEditTime: 2026-07-31 17:33:46
 * @Description: 判断文本是否溢出
 */
'use client'

import { Tooltip, toast } from '@heroui/react'
import { track } from '@vercel/analytics'
import { memo, useCallback, useEffect, useRef, useState } from 'react'

import { useAiAssistantStore } from '@/components/AiAssistant/store'

import { useIsMobile } from '@/hooks/use-is-mobile'
import { appLinkFor, getAppOpenPref, launchApp } from '@/lib/app-links'
import { copyText } from '@/lib/clipboard'
import { useAppOpenStore } from '@/store/useAppOpenStore'
import { useContextMenuStore } from '@/store/useContextMenuStore'

import type { HOT_ITEMS } from '@/enums'
import type { HotListItem } from '@/types'
import type { MouseEvent } from 'react'

/** Normalize XHH share/API URLs to the public post URL and strip share-session query tokens. */
function analysisUrlOf(rawUrl: string): string {
  try {
    const url = new URL(rawUrl)
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    if (host === 'xiaoheihe.cn' || host.endsWith('.xiaoheihe.cn')) {
      const id = /\/(?:bbs\/)?link\/(\d{5,})/.exec(url.pathname)?.[1]
        || url.searchParams.get('link_id')
        || url.searchParams.get('linkid')
        || url.searchParams.get('linkId')
      if (id && /^\d{5,}$/.test(id))
        return `https://www.xiaoheihe.cn/app/bbs/link/${id}`

      url.searchParams.delete('h_session_id')
      return url.toString()
    }
    return url.toString()
  }
  catch {
    return rawUrl
  }
}

interface OverflowDetectorProps {
  record: HotListItem
  type: typeof HOT_ITEMS.valueType
}

const OverflowDetector = memo(({
  record,
  type,
}: OverflowDetectorProps) => {
  const ref = useRef<HTMLDivElement>(null)

  // 判断是否是移动端
  const isMobile = useIsMobile()

  const openContextMenu = useContextMenuStore(state => state.open)
  const openAiWith = useAiAssistantStore(state => state.openWith)
  const openAppPrompt = useAppOpenStore(state => state.open)
  const showAppFailed = useAppOpenStore(state => state.openFailed)

  // 内容是否溢出
  const [isOverflowing, setIsOverflowing] = useState(false)

  // 点击标题回调
  const handleTitle = (url: string) => {
    // 移动端：该源有对应 App 时先问一句（用 App 打开 / 在浏览器打开）
    if (isMobile) {
      const app = appLinkFor(type, url, record.title)
      if (app) {
        const pref = getAppOpenPref()
        if (pref === 'app') {
          // 记住过"优先 App"：直接唤起，没装 App 时把提示面板作为回落显示
          track(type)
          void launchApp(app.href).then((notOpened) => {
            // 没跳走 → 以"没打开"的回落态展示（不能调 open()，那会把失败态复位成普通询问）
            if (notOpened)
              showAppFailed({ url, appName: app.appName, href: app.href })
          })
          return
        }
        if (pref === 'ask') {
          track(type)
          openAppPrompt({ url, appName: app.appName, href: app.href })
          return
        }
      }
    }
    window.open(url, '_blank', 'noopener,noreferrer')
    track(type)
  }

  // 复制到剪贴板并给出反馈
  const copy = useCallback(async (text: string, label: string) => {
    if (!text) {
      toast.warning(`没有可复制的${label}`)
      return
    }
    // copyText 内部已做「异步 API → textarea 兜底」，HTTP 局域网下也能复制
    const ok = await copyText(text)
    if (ok)
      toast.success(`已复制${label}`, { timeout: 1500 })
    else
      toast.danger('复制失败，请手动选择文本后复制')
  }, [])

  // 右键菜单：复制标题 / 复制链接 / 分析此条（2026-09-15 按用户要求去掉「AI」字样）
  const handleContextMenu = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    const url = (isMobile ? record.mobileUrl : record.url) || record.url || record.mobileUrl || ''

    openContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        {
          key: 'copy-title',
          label: '复制标题',
          onSelect: () => copy(record.title, '标题'),
        },
        {
          key: 'copy-url',
          label: '复制链接',
          onSelect: () => copy(url, '链接'),
        },
        {
          key: 'ai-analyze',
          label: '分析此条',
          onSelect: () => {
            // 直接打开首页右下角的 AI 助手「对话」抽屉；不再跳 `/AiModel`，也省掉一次页面导航。
            openAiWith({ tab: 'chat', title: record.title, url: url ? analysisUrlOf(url) : undefined, source: type })
          },
        },
      ],
    })
  }, [copy, isMobile, openAiWith, openContextMenu, record.mobileUrl, record.title, record.url])

  // 只在组件挂载时检测一次 overflow
  useEffect(() => {
    const el = ref.current
    if (!el)
      return

    const checkOverflow = () => {
      setIsOverflowing(el.scrollWidth > el.clientWidth)
    }

    // 等 DOM 渲染完成
    requestAnimationFrame(checkOverflow)
  }, [])

  return (
    <Tooltip isDisabled={!isOverflowing} delay={0}>
      <Tooltip.Trigger aria-label={record.title} className="min-w-0 flex-1">
        <div
          ref={ref}
          onClick={() => handleTitle(isMobile ? record.mobileUrl : record.url)}
          onContextMenu={handleContextMenu}
          className="line-clamp-2 min-h-11 sm:min-h-0 sm:line-clamp-none sm:truncate sm:py-1 break-words text-left transition-colors ease-in duration-300 cursor-pointer text-sm font-medium relative py-1 after:absolute after:content-[''] after:h-0.5 after:w-0 after:left-0 after:bottom-0 after:bg-border after:transition-[width] after:duration-500 sm:hover:translate-x-1 sm:hover:after:w-full"
        >
          {record.title}
        </div>
      </Tooltip.Trigger>

      <Tooltip.Content placement="top">
        <Tooltip.Arrow />
        <p>{record.title}</p>
      </Tooltip.Content>
    </Tooltip>
  )
})

export default OverflowDetector

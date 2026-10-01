/*
 * @Author: 白雾茫茫丶<baiwumm.com>
 * @Date: 2025-11-20 14:33:28
 * @LastEditors: 白雾茫茫丶<baiwumm.com>
 * @LastEditTime: 2026-07-31 17:38:56
 * @Description: 热榜卡片
 */
'use client'
import 'dayjs/locale/zh-cn'

import { ArrowsRotateRight, CircleCheckFill, CircleXmarkFill } from '@gravity-ui/icons'
import {
  Button,
  Card,
  Chip,
  Description,
  Label,
  Separator,
  Spinner,
  Tooltip,
} from '@heroui/react'
import { useRequest } from 'ahooks'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { motion, useInView } from 'motion/react'
import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'

import BlurFade from '@/components/BlurFade'
import SkeletonCard from '@/components/SkeletonCard'
import { RESPONSE } from '@/enums'
import { useAppStore } from '@/store/useAppStore'

import SourceListModal from '@/components/SourceListModal'

import RowComponent from './RowComponent'

import type { HotListConfig, HotListItem, IResponse } from '@/types'

dayjs.extend(utc)
dayjs.extend(timezone)
// 引入处理相对时间的插件
dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

/**
 * 模块级数据缓存（key = 数据源 value）。
 *
 * 解决「从首页路由到其它页面再返回，卡片会全部重新拉取一遍」的问题：
 * 那些页面切换是客户端路由，模块级缓存能存活，返回时直接用上次数据渲染、**不发请求**。
 * 只有两种操作会重新拉取：卡片右下角的**手动刷新**，以及**浏览器整页刷新**（此时模块缓存已被清空）。
 */
const hotDataCache = new Map<string, { list: HotListItem[], at: number }>()
/** 模块缓存 TTL：超过后路由返回时重新拉取，避免热榜数据长时间不更新 */
const HOT_CACHE_TTL_MS = 10 * 60 * 1000

function cachedHotList(value: string): HotListItem[] | undefined {
  const hit = hotDataCache.get(value)
  if (!hit)
    return undefined
  if (Date.now() - hit.at > HOT_CACHE_TTL_MS) {
    hotDataCache.delete(value)
    return undefined
  }
  return hit.list
}

/**
 * 折叠预览的行数（2026-09-15 移动端改版）：
 *  - 手机（<640px）默认 5 行，其余行用 `max-sm:hidden` 藏起来，不引入 JS 断点、避免 hydration 差异
 *  - ≥640px 默认 8 行（正好一整屏内容区，不再出现"第 8 行被切一半"）
 *  - 点「展开全部」后不受上限约束
 */
const PREVIEW_ROWS = 8
const PREVIEW_ROWS_MOBILE = 5

function HotCard({ value, label, tip, prefix, suffix }: HotListConfig) {
  const setUpdateTime = useAppStore(state => state.setUpdateTime)
  /** 渲染所用数据：优先取模块缓存，这样路由返回时无需重新请求 */
  const [list, setList] = useState<HotListItem[] | undefined>(() => cachedHotList(value))
  const ref = useRef<HTMLDivElement>(null)
  const isInView = useInView(ref, { once: true })

  const total = list?.length ?? 0
  const visibleRows = Math.min(total, PREVIEW_ROWS)
  const canExpand = total > PREVIEW_ROWS_MOBILE

  // 更新相对时间
  const relativeText = useAppStore(state =>
    state.getRelativeTime(value),
  )

  // 失败自动恢复（2026-08-05 修复）：失败后 60s 自动重试，最多 5 次，成功后重置
  const retryRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; count: number }>({ timer: null, count: 0 })
  const runRef = useRef<() => void>(() => {})

  useEffect(() => {
    // 组件卸载时清理定时器
    return () => {
      if (retryRef.current.timer) {
        clearTimeout(retryRef.current.timer)
      }
    }
  }, [])

  const { loading, error, run } = useRequest(
    async () => {
      const response = await fetch(`/api/${value}`)
      if (response.status !== RESPONSE.SUCCESS) {
        throw new Error('Request failed')
      }
      const result: IResponse = await response.json()
      if (result.code === RESPONSE.ERROR) {
        throw new Error('API returned error')
      }

      // 空数据同样视为失败（对应上游 7307940 的修复）：
      // 部分源会返回 200 但 0 条（登录墙、接口变更、反爬），若当成成功，
      // 页脚会显示「刚刚更新」误导用户，并且卡片的失败自动重试也不会触发。
      const list = result.data || []
      if (!list.length) {
        throw new Error('API returned empty data')
      }

      // ⚠️ 只在**成功且拿到数据**时记录更新时间。
      // 这里原本放在 finally 里，导致请求失败/空数据也写时间戳 → 页脚显示「刚刚更新」。
      setUpdateTime({ [value]: dayjs().valueOf() })
      hotDataCache.set(value, { list, at: Date.now() }) // 写入模块缓存（带 TTL），供路由返回时复用
      return list
    },
    {
      manual: true,
      debounceWait: 300,
      retryCount: 3,
      onSuccess: (result: HotListItem[]) => {
        // 成功后重置重试计数，并同步到渲染 state
        retryRef.current.count = 0
        setList(result)
      },
      onError: () => {
        const r = retryRef.current
        if (r.timer) {
          clearTimeout(r.timer)
        }
        // 最多自动重试 5 次（约 5 分钟），之后需手动刷新
        if (r.count >= 5) {
          return
        }
        r.count += 1
        r.timer = setTimeout(() => runRef.current(), 60000)
      },
    },
  )
  runRef.current = run

  // ✅ 进入视口才自动加载；但**已有缓存就跳过**，避免路由返回时把整页卡片重新请求一遍
  useEffect(() => {
    if (isInView && !cachedHotList(value)) {
      run()
    }
  }, [isInView, run, value])
  return (
    <Card
      ref={ref}
      // id/scroll-mt 供「源跳转条」锚定：手机上头部 68px + 跳转条 44px ≈ 112px
      id={value}
      className="p-0 gap-0 scroll-mt-[132px] md:scroll-mt-[88px]"
    >
      <Card.Header className="flex justify-between items-center flex-row py-2 px-3">
        <div className="flex items-center gap-2">
          <Image
            alt={`${label}${tip}`}
            height={20}
            src={`/images/${value}.svg`}
            width={20}
            className="rounded-md shrink-0"
          />
          <Label className="font-bold text-sm">{label}</Label>
        </div>
        <motion.div
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          initial={{ opacity: 0, scale: 0.8 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
        >
          <Chip
            color={list?.length ? 'success' : 'danger'}
            size="sm"
            variant="soft"
            className="px-2 py-0.5"
          >
            {loading
              ? (
                  <Spinner size="sm" />
                )
              : list?.length
                ? (
                    <CircleCheckFill width={14} />
                  )
                : (
                    <CircleXmarkFill width={14} />
                  )}
            {tip}
          </Chip>
        </motion.div>
      </Card.Header>
      <Separator />
      {/* 内容区高度自适应条目数；完整榜单放入可滚动弹层，避免页面被长列表撑高 */}
      <Card.Content className="relative py-0">
        {loading && (
          // 骨架屏同样按手机 5 行裁一下，避免加载完成时卡片高度忽然变化
          <div className="max-sm:[&>*:nth-child(n+6)]:hidden">
            <SkeletonCard />
          </div>
        )}
        {!loading && !total && (
          // 失败态：短文案 + 重试按钮（去掉长句与 emoji，避免被卡片底部裁切）
          <div className="flex flex-col justify-center items-center gap-3 px-6 py-8 text-center">
            <Description className="leading-5">
              {error ? '加载失败，请稍后重试' : '等待加载…'}
            </Description>
            {error && (
              <Button
                size="sm"
                variant="ghost"
                onPress={run}
                className="text-muted"
              >
                <ArrowsRotateRight />
                重试
              </Button>
            )}
          </div>
        )}
        {!loading && !!total && (
          <>
            <BlurFade className="pl-3 pr-2 [&>*:last-child]:border-b-0">
              {Array.from({ length: visibleRows }).map((_, index) => (
                <div key={index} className={index >= PREVIEW_ROWS_MOBILE ? 'max-sm:hidden' : undefined}>
                  <RowComponent
                    data={list as HotListItem[]}
                    index={index}
                    prefix={prefix}
                    suffix={suffix}
                    value={value}
                  />
                </div>
              ))}
            </BlurFade>
            {canExpand && (
              <div className="border-t border-separator">
                <SourceListModal
                  value={value}
                  list={list as HotListItem[]}
                  prefix={prefix}
                  suffix={suffix}
                />
              </div>
            )}
          </>
        )}
      </Card.Content>
      <Separator />
      <Card.Footer className="py-1.5 px-3">
        <div className="flex text-center justify-between w-full items-center space-x-4 text-small h-5">
          <Description className="w-1/2">
            {/* 注意：store 的 getRelativeTime 在没有时间戳时返回「刚刚」，
                若不拦一下，空数据/失败的源反而会显示「刚刚更新」，误导用户以为数据是新的。 */}
            {loading
              ? '正在加载中...'
              : error
                ? '更新失败'
                : list?.length
                  ? `${relativeText}更新`
                  : '等待加载…'}
          </Description>
          <Separator orientation="vertical" className="flex-none" />
          <div className="flex w-1/2 justify-center">
            <Tooltip delay={0}>
              <Button
                size="sm"
                variant="ghost"
                isDisabled={loading}
                isIconOnly
                onPress={run}
                className="text-muted"
              >
                <ArrowsRotateRight className={loading ? 'animate-spin' : ''} />
              </Button>
              <Tooltip.Content placement="bottom" showArrow>
                <Tooltip.Arrow />
                获取最新
              </Tooltip.Content>
            </Tooltip>
          </div>
        </div>
      </Card.Footer>
    </Card>
  )
}

export default HotCard

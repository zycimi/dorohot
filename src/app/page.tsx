/*
 * @Author: 白雾茫茫丶<baiwumm.com>
 * @Date: 2025-11-19 15:55:09
 * @LastEditors: 白雾茫茫丶<baiwumm.com>
 * @LastEditTime: 2026-01-14 15:17:15
 * @Description: 首页
 */
'use client'

import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'

import AiAssistant from '@/components/AiAssistant'
import HotCard from '@/components/HotCard'
import SourceNav from '@/components/SourceNav'
import { HOT_ITEMS } from '@/enums'
import { useDeviceKind } from '@/hooks/use-device-kind'
import { useAppStore } from '@/store/useAppStore'

export default function Home() {
  const [mounted, setMounted] = useState(false)
  // 桌面端 / 手机端各一套首页配置；按当前视口选用
  const device = useDeviceKind()
  const desktop = useAppStore(state => state.desktop)
  const mobile = useAppStore(state => state.mobile)
  const { navPosition, sortItems, hiddenItems } = device === 'mobile' ? mobile : desktop

  const visibleItems = useMemo(() => {
    const hiddenSet = new Set(hiddenItems ?? [])
    return sortItems.filter(value => !hiddenSet.has(value))
  }, [hiddenItems, sortItems])

  useEffect(() => {
    const timer = setTimeout(setMounted, 0, true)
    return () => clearTimeout(timer)
  }, [])

  if (!mounted) {
    return null
  }

  return (
    <div className={`home-shell nav-${navPosition}`}>
      <SourceNav items={visibleItems} position={navPosition} />
      {/* 👇 父容器必须是 motion.div 并开启 layout */}
      <motion.div
        layout // ✅ 启用布局动画
        // min(100%,20rem)：320px 窄屏下若仍用 20rem 硬下限，轨道会撑到 320px 而内容盒只有 288px → 横向滚动
        className="home-grid grid gap-4 items-start grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))]"
      >
        <AnimatePresence>
          {visibleItems.map((value) => {
            const raw = HOT_ITEMS.raw(value)
            return (
              // 👇 每个子项也必须是 motion.div + layout
              <motion.div
                key={raw.value}
                exit={{ opacity: 0, filter: 'blur(8px)', y: 20 }}
                initial={{ opacity: 0, filter: 'blur(8px)', y: 20 }}
                layout // ✅ 关键：让位置变化可动画
                transition={{ duration: 0.5, ease: 'easeOut' }}
                viewport={{ once: true }}
                whileInView={{ opacity: 1, filter: 'blur(0px)', y: 0 }}
              >
                <HotCard {...raw} />
              </motion.div>
            )
          })}
        </AnimatePresence>
      </motion.div>
      {/* 首页右下角悬浮 AI 助手；设置已搬到 /settings */}
      <AiAssistant />
    </div>
  )
}

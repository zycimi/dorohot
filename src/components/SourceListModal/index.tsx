/*
 * @Description: 数据源完整榜单弹层（2026-09-15 桌面端改版新增）
 *
 * 为什么用弹层而不是就地展开：卡片在桌面是网格（grid）布局，就地展开会把
 * **整行的轨道高度**撑到最高的那张卡（实测 462 → 2225px），同排另两张卡片下方
 * 各留 1763px 页面底色空洞，后面 19 张卡整体下移——看起来就是"结构被打乱"。
 * 弹层化后主网格完全不动（卡片 top/height/页面总高都不变），而且能一次看全。
 *
 * 实现要点：
 *  - **复用 `RowComponent` 渲染条目**：右键菜单、移动端 mobileUrl 选择、热度格式化与卡片内一致
 *  - 手机使用安全区适配的底部抽屉；桌面居中宽抽屉，主体独立滚动
 *  - 桌面双列、手机单列；数据来自调用方缓存，不重新请求
 *  - 数据来自调用方手上的 list（模块缓存那份），**不重新请求**
 */
'use client'

import { Button, Chip, Description, Drawer } from '@heroui/react'
import Image from 'next/image'
import { useState } from 'react'

import RowComponent from '@/components/HotCard/RowComponent'
import { HOT_ITEMS } from '@/enums'

import type { HotListItem } from '@/types'
import type { ReactNode } from 'react'

interface Props {
  /** 数据源 value（决定图标） */
  value: string
  list: HotListItem[]
  prefix?: ReactNode
  suffix?: ReactNode
}

export default function SourceListModal({ value, list, prefix, suffix }: Props) {
  const [open, setOpen] = useState(false)
  const raw = HOT_ITEMS.raw(value)
  const label = raw?.label || value
  const tip = raw?.tip || ''

  // 左列优先：上半数进第一列，剩下的进第二列（列内仍是连续名次）
  const half = Math.ceil(list.length / 2)
  const columns = [list.slice(0, half), list.slice(half)].filter(c => c.length)

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-full min-h-11 md:min-h-7 text-xs text-muted font-normal"
        onPress={() => setOpen(true)}
      >
        <span className="md:hidden">查看全部榜单 · {list.length} 条</span>
        <span className="hidden md:inline">查看全部 {list.length} 条</span>
      </Button>
      <Drawer isOpen={open} onOpenChange={setOpen}>
        <Drawer.Backdrop>
          <Drawer.Content placement="bottom" className="md:items-center md:justify-center">
            <Drawer.Dialog className="w-full max-h-[86dvh] rounded-t-2xl! md:w-[min(1080px,94vw)] md:max-w-none! md:rounded-2xl!">
              <Drawer.CloseTrigger />
              <Drawer.Header className="shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <Image alt={`${label}${tip}`} height={22} src={`/images/${value}.svg`} width={22} className="rounded-md shrink-0" />
                  <Drawer.Heading className="font-bold truncate">{label}</Drawer.Heading>
                  <span className="text-xs text-muted font-normal shrink-0">共 {list.length} 条</span>
                  {tip && <Chip color="success" size="sm" variant="soft" className="px-2 py-0.5 shrink-0">{tip}</Chip>}
                </div>
              </Drawer.Header>
              <Drawer.Body className="min-h-0 overflow-y-auto">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 items-start">
                  {columns.map((column, columnIndex) => (
                    <div key={columnIndex}>
                      {column.map((_, indexInColumn) => {
                        const index = columnIndex === 0 ? indexInColumn : columns[0].length + indexInColumn
                        return <RowComponent key={index} data={list} index={index} prefix={prefix} suffix={suffix} value={value as typeof HOT_ITEMS.valueType} />
                      })}
                    </div>
                  ))}
                </div>
              </Drawer.Body>
              <Drawer.Footer>
                <Description className="text-xs text-muted">名次按来源榜单顺序；标题可右键复制或分析此条</Description>
              </Drawer.Footer>
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>
      </Drawer>
    </>
  )
}

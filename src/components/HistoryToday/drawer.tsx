/*
 * @Description: 「历史上的今天」全部事件抽屉（头部与页脚共用）
 */
'use client'
import { Drawer } from '@heroui/react'

import HistoryList from './list'

import type { HotListItem } from '@/types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  list: HotListItem[]
  dateLabel: string
}

export default function HistoryDrawer({ open, onOpenChange, list, dateLabel }: Props) {
  return (
    <Drawer isOpen={open} onOpenChange={onOpenChange}>
      <Drawer.Backdrop>
        <Drawer.Content placement="bottom" className="md:items-center md:justify-center">
          <Drawer.Dialog className="w-full max-h-[80dvh] rounded-t-2xl! md:w-[min(640px,92vw)] md:max-w-none! md:rounded-2xl!">
            <Drawer.CloseTrigger />
            <Drawer.Header className="shrink-0">
              <Drawer.Heading className="font-bold">历史上的今天 · {dateLabel}</Drawer.Heading>
            </Drawer.Header>
            <Drawer.Body className="min-h-0 overflow-y-auto">
              <HistoryList list={list} />
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  )
}

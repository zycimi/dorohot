/*
 * @Description: 右键菜单全局状态
 *
 * 菜单本体只渲染一份并挂到 body 上（见 components/ContextMenu），
 * 任意组件（如热榜标题）通过 open() 唤起。之所以不做成行内菜单，是因为热榜使用
 * 虚拟列表，把菜单渲染在行内会被容器裁切、滚动时也会错位。
 */

'use client'
import { create } from 'zustand'

export interface ContextMenuItem {
  key: string
  label: string
  /** 右侧淡色说明文字（如快捷键） */
  hint?: string
  danger?: boolean
  onSelect: () => void
}

interface ContextMenuState {
  visible: boolean
  x: number
  y: number
  items: ContextMenuItem[]
  open: (payload: { x: number, y: number, items: ContextMenuItem[] }) => void
  close: () => void
}

export const useContextMenuStore = create<ContextMenuState>(set => ({
  visible: false,
  x: 0,
  y: 0,
  items: [],
  open: ({ x, y, items }) => set({ visible: true, x, y, items }),
  close: () => set({ visible: false, items: [] }),
}))

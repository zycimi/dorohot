/*
 * @Description: 全局右键菜单（挂 body，跟随光标，自动避让视口边缘）
 */
'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { portalHost } from '@/lib/portal-host'
import { useContextMenuStore } from '@/store/useContextMenuStore'

const EDGE_PADDING = 8

export default function ContextMenu() {
  const visible = useContextMenuStore(s => s.visible)
  const x = useContextMenuStore(s => s.x)
  const y = useContextMenuStore(s => s.y)
  const items = useContextMenuStore(s => s.items)
  const close = useContextMenuStore(s => s.close)

  const ref = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)
  const [pos, setPos] = useState({ x, y })

  // Portal 只能挂在客户端，避免 SSR 期间找不到 document
  useEffect(() => setMounted(true), [])

  // 贴边时向内收，保证菜单完整可见
  useLayoutEffect(() => {
    if (!visible)
      return
    const el = ref.current
    const width = el?.offsetWidth ?? 0
    const height = el?.offsetHeight ?? 0
    setPos({
      // 用 clientWidth 而不是 innerWidth：极窄视口下 innerWidth 会被内容撑大，钳制后仍出界
      x: Math.max(EDGE_PADDING, Math.min(x, document.documentElement.clientWidth - width - EDGE_PADDING)),
      y: Math.max(EDGE_PADDING, Math.min(y, window.innerHeight - height - EDGE_PADDING)),
    })
  }, [visible, x, y, items])

  // 关闭时机：Esc / 滚动 / 尺寸变化 / 窗口失焦
  useEffect(() => {
    if (!visible)
      return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape')
        close()
    }
    const onDismiss = () => close()

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onDismiss, true)
    window.addEventListener('resize', onDismiss)
    window.addEventListener('blur', onDismiss)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onDismiss, true)
      window.removeEventListener('resize', onDismiss)
      window.removeEventListener('blur', onDismiss)
    }
  }, [visible, close])

  const handleSelect = useCallback((onSelect: () => void) => {
    close()
    onSelect()
  }, [close])

  if (!mounted || !visible || !items.length)
    return null

  return createPortal(
    <>
      {/* 透明遮罩：点击任意位置关闭，同时阻止底层元素响应 hover */}
      <div
        // ⚠️ 层级必须高过 HeroUI 的浮层：它用 `--z-index-overlay: 100000`（见 @heroui/styles 的 base.css），
        // 所以这个菜单原先的 z-[1000] 会被弹层整个盖住——在「查看全部」弹层里右键等于没反应。
        // 直接引用该 CSS 变量（+1/+2），HeroUI 改数值时不用跟着改。
        className="fixed inset-0"
        style={{ zIndex: 'calc(var(--z-index-overlay, 100000) + 1)' }}
        onClick={close}
        onContextMenu={(event) => {
          event.preventDefault()
          close()
        }}
      />
      <div
        ref={ref}
        role="menu"
        className="fixed min-w-44 py-1 rounded-lg border border-default bg-surface shadow-lg"
        style={{ left: pos.x, top: pos.y, zIndex: 'calc(var(--z-index-overlay, 100000) + 2)' }}
      >
        {items.map(item => (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            onClick={() => handleSelect(item.onSelect)}
            className={`w-full flex items-center justify-between gap-6 px-3 py-1.5 text-left text-sm cursor-pointer transition-colors hover:bg-surface-secondary ${item.danger ? 'text-danger' : 'text-foreground'}`}
          >
            <span>{item.label}</span>
            {item.hint && <span className="text-xs text-default-500">{item.hint}</span>}
          </button>
        ))}
      </div>
    </>,
    portalHost(),
  )
}

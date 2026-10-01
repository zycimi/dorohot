/*
 * @Description: 源跳转条（2026-09-15 移动端改版新增；2026-09-24 支持四位置）
 *
 * 为什么需要：手机单列时全页要滚 11+ 屏，想直接看某个源只能一路往下滑。
 * 这条横向 chip 条点一下即滚到对应卡片，并跟随滚动高亮当前所在源。
 *
 * 实现要点：
 *  - 位置由设置决定（top / bottom / left / right），四种位置的尺寸与吸顶偏移全部写在
 *    `src/styles/ai.css` 的 `.source-nav*` 规则里（统一走 `--site-header-h`）；
 *    本组件不再写内联布局样式，避免内联值覆盖 CSS 造成"某一种位置失效"。
 *  - 锚点用卡片根上的 `id={value}` + `scroll-mt-*`（见 HotCard），滚动落点再用下面的
 *    `settle` 以**实测的**头部/条外框做补正（卡片是懒加载的，落点会被后到的数据顶偏）。
 *  - 高亮用 IntersectionObserver，`rootMargin` 按实测的 Header + 本条高度留出上边距，
 *    下边收掉 60%，取"最靠上的那个可见卡片"。
 *  - 横向自动居中用 scrollLeft 手算，不用 scrollIntoView（后者可能连带改动纵向滚动位置）。
 *  - 滚动隐藏（Header + 本条）由 `use-nav-auto-hide` 统一负责，这里不再挂 scroll 监听。
 */
'use client'

import { Drawer } from '@heroui/react'
import { Magnifier } from '@gravity-ui/icons'
import Image from 'next/image'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { HOT_ITEMS } from '@/enums'
import type { NavPosition } from '@/store/useAppStore'

/** Header 与内容之间的间距（layout.tsx 的 body 为 flex + gap-4） */
const NAV_GAP = 16

/** 用户偏好减少动效时不做平滑滚动（系统「减少动态效果」） */
function scrollBehavior(): ScrollBehavior {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 'auto'
    : 'smooth'
}

export default function SourceNav({ items, position }: { items: string[], position: NavPosition }) {
  const [active, setActive] = useState('')
  const [chooserOpen, setChooserOpen] = useState(false)
  const [query, setQuery] = useState('')
  /** 高亮判定要避开的上边距（Header + 间隙 + 上下条自身高度），由实测得出 */
  const [topInset, setTopInset] = useState(0)
  const scrollerRef = useRef<HTMLElement | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const isSide = position === 'left' || position === 'right'

  /**
   * 实测吸顶区域高度并跟随变化。用 ResizeObserver 而不是写常量：
   *   Header 是「手机 py-3 / ≥640px p-4」两套内边距，字体加载、断点切换都会改高度，
   *   一旦与实际不符，高亮区间就会整体偏上/偏下。
   */
  useLayoutEffect(() => {
    const nav = scrollerRef.current
    const header = document.querySelector<HTMLElement>('.site-header')
    const measure = () => {
      const headerH = header?.getBoundingClientRect().height ?? 0
      const navH = isSide ? 0 : nav?.getBoundingClientRect().height ?? 0
      const next = Math.round(headerH + NAV_GAP + navH)
      setTopInset(prev => (prev === next ? prev : next))
    }
    measure()
    const observer = new ResizeObserver(measure)
    if (header)
      observer.observe(header)
    if (nav)
      observer.observe(nav)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [isSide, position])

  // 高亮：取当前视口内最靠上的卡片
  useEffect(() => {
    if (!topInset)
      return
    const targets = items
      .map(value => document.getElementById(value))
      .filter((el): el is HTMLElement => !!el)
    if (!targets.length)
      return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter(entry => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0])
          setActive(visible[0].target.id)
      },
      { rootMargin: `-${topInset}px 0px -60% 0px`, threshold: 0 },
    )
    targets.forEach(el => observer.observe(el))
    return () => observer.disconnect()
  }, [items, topInset])

  // 高亮项自动滚到本条中间（只动横向）
  useEffect(() => {
    if (!active)
      return
    const scroller = scrollerRef.current
    const chip = scroller?.querySelector<HTMLElement>(`[data-source="${active}"]`)
    if (!scroller || !chip)
      return
    scroller.scrollTo({
      left: chip.offsetLeft - scroller.clientWidth / 2 + chip.clientWidth / 2,
      behavior: scrollBehavior(),
    })
  }, [active])

  /**
   * 跳到某个源。
   *
   * 落点用**实测外框**算，不用常量：
   *  - 顶部条：贴在头部下方 → 落在条底边 + 4px
   *  - 其余位置（底栏 / 左右侧栏 / 手机两侧快捷入口）：头部下方 + 8px
   *    （底栏在屏幕底部、侧栏在左右，都不会从上方挡住卡片）
   * ⚠️ 卡片是**懒加载**的：滚动途中上方卡片可能刚拿到数据而变高，把落点顶偏
   *（实测偏 20px 上下）。所以滚完再做几次「对齐补正」，偏差超过 4px 就补一次，
   * 最多 3 次，之后不再动。
   */
  const jump = useCallback((value: string) => {
    if (!document.getElementById(value))
      return
    document.getElementById(value)?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })

    let tries = 0
    const settle = () => {
      const el = document.getElementById(value)
      if (!el)
        return
      const navRect = scrollerRef.current?.getBoundingClientRect()
      const headerRect = document.querySelector<HTMLElement>('.site-header')?.getBoundingClientRect()
      const want = position === 'top' && navRect
        ? navRect.bottom + 4
        : (headerRect?.bottom ?? 0) + 8
      const delta = el.getBoundingClientRect().top - want
      if (Math.abs(delta) > 4 && tries < 3) {
        tries += 1
        window.scrollBy({ top: delta, behavior: scrollBehavior() })
        window.setTimeout(settle, 450)
      }
    }
    window.setTimeout(settle, 450)
  }, [position])

  const filteredItems = items.filter((value) => {
    const raw = HOT_ITEMS.raw(value)
    const keyword = query.trim().toLowerCase()
    return !keyword || !!raw && (raw.label.toLowerCase().includes(keyword) || raw.tip.toLowerCase().includes(keyword) || value.toLowerCase().includes(keyword))
  })

  useEffect(() => {
    if (!chooserOpen)
      return
    searchRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape')
        setChooserOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [chooserOpen])

  const selectSource = (value: string) => {
    setChooserOpen(false)
    setQuery('')
    requestAnimationFrame(() => jump(value))
  }

  if (items.length < 2)
    return null

  return (
    <>
      <nav
        ref={scrollerRef}
        className={`source-nav source-nav-${position}`}
        data-position={position}
        aria-label="数据源快速跳转"
      >
        <button
          type="button"
          onClick={() => setChooserOpen(true)}
          aria-haspopup="dialog"
          aria-label="搜索数据源"
          title="搜索数据源"
          className="source-nav-all shrink-0 min-h-11 flex items-center px-3 rounded-full border border-accent text-accent bg-accent/10 text-xs font-medium cursor-pointer"
        >
          <Magnifier width={18} height={18} aria-hidden="true" />
        </button>
        {items.map((value) => {
          const raw = HOT_ITEMS.raw(value)
          if (!raw)
            return null
          const on = active === value
          return (
            <button
              key={value}
              type="button"
              data-source={value}
              onClick={() => jump(value)}
              aria-label={raw.label}
              title={`${raw.label} · ${raw.tip}`}
              aria-current={on ? 'true' : undefined}
              className={`source-nav-chip shrink-0 min-h-11 flex items-center gap-1.5 px-3 rounded-full border text-xs transition-colors cursor-pointer ${
                on
                  ? 'border-accent text-accent bg-accent/10'
                  : 'border-border text-muted hover:text-foreground bg-surface'
              }`}
            >
              <Image alt="" width={16} height={16} src={`/images/${value}.svg`} className="rounded-sm shrink-0" />
              <span className="whitespace-nowrap">{raw.label}</span>
            </button>
          )
        })}
      </nav>
      <Drawer isOpen={chooserOpen} onOpenChange={setChooserOpen}>
        <Drawer.Backdrop>
          <Drawer.Content placement={isSide ? position : 'bottom'}>
            <Drawer.Dialog
              className="w-full max-h-[78dvh] rounded-t-2xl! data-[placement=left]:h-full data-[placement=right]:h-full data-[placement=left]:max-w-[min(90vw,24rem)] data-[placement=right]:max-w-[min(90vw,24rem)]"
              style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}
            >
              <Drawer.CloseTrigger />
              <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted/40" />
              <Drawer.Header className="shrink-0 px-4 pt-4 pb-3">
                <div>
                  <Drawer.Heading>选择数据源</Drawer.Heading>
                  <p className="mt-1 text-xs text-muted">当前显示 {items.length} 个源</p>
                </div>
              </Drawer.Header>
              <Drawer.Body className="mt-0 min-h-0 flex flex-col px-4">
                <div className="pb-3">
                  <input
                    ref={searchRef}
                    type="search"
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    placeholder="搜索数据源名称或类别"
                    aria-label="搜索数据源"
                    className="w-full min-h-11 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-accent"
                  />
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2" role="listbox" aria-label="数据源">
                  {filteredItems.length
                    ? (
                        <div className="grid grid-cols-2 gap-2">
                          {filteredItems.map((value) => {
                            const raw = HOT_ITEMS.raw(value)
                            if (!raw)
                              return null
                            return (
                              <button
                                key={value}
                                type="button"
                                role="option"
                                aria-selected={active === value}
                                onClick={() => selectSource(value)}
                                className={`min-h-12 min-w-0 flex items-center gap-2 rounded-xl border px-2.5 text-left text-xs cursor-pointer ${active === value ? 'border-accent bg-accent/10 text-accent' : 'border-border bg-background'}`}
                              >
                                <Image alt="" width={20} height={20} src={`/images/${value}.svg`} className="shrink-0 rounded-sm" />
                                <span className="min-w-0 line-clamp-2 break-words">{raw.label}</span>
                              </button>
                            )
                          })}
                        </div>
                      )
                    : <p className="py-8 text-center text-sm text-muted">没有匹配的数据源</p>}
                </div>
              </Drawer.Body>
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>
      </Drawer>
    </>
  )
}

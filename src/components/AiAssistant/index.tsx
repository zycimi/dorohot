/*
 * @Description: 首页悬浮 AI 助手外壳（右下气泡 + HeroUI Drawer）
 *
 * 2026-09-16 第 1 段把 `ai-panel.tsx` 拆成 `AiAssistant/`；第 2 段把四项能力收进
 * 首页右侧（桌面）/底部（手机）抽屉，`/settings` 独立承载设置。
 *
 * 这里只负责“外壳”：气泡、抽屉、配置状态与 tab 切换。四项能力的输入、结果、
 * loading 都在 `store.ts` 的模块级 store 里，所以关抽屉不会丢进度。
 */
'use client'

import { ArrowsExpandHorizontal, ArrowsExpandVertical, FaceRobot } from '@gravity-ui/icons'
import { Button, Drawer, Tooltip } from '@heroui/react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useNotify } from '@/lib/ai-client'

import { StatusBar } from './status-bar'
import { useAiAssistantStore } from './store'

import { ChatTab } from './chat-tab'
import { AnalyzeTab, BriefingTab, SummaryTab } from './tabs'

import type { AiConfig } from '@/lib/ai-client'
import type { AiFeature } from './store'

const TABS: { key: AiFeature, label: string }[] = [
  { key: 'chat', label: 'AI对话' },
  { key: 'summary', label: '生成摘要' },
  { key: 'briefing', label: '每日简报' },
  { key: 'analyze', label: '趋势分析' },
]

const PANEL_SIZE_KEY = 'dorohot-ai-panel-size'
const PANEL_MIN_WIDTH = 400
const PANEL_DEFAULT_WIDTH = 560
const PANEL_WIDE_WIDTH = 900
const PANEL_MIN_HEIGHT = 45
const PANEL_DEFAULT_HEIGHT = 88
const PANEL_TALL_HEIGHT = 96

interface PanelSize {
  /** 桌面端抽屉宽度（px） */
  width: number
  /** 手机端抽屉高度（dvh） */
  height: number
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

/** @description: 读取上次调整过的 AI 面板尺寸（越界/损坏一律回默认值） */
function loadPanelSize(): PanelSize {
  if (typeof window === 'undefined')
    return { width: PANEL_DEFAULT_WIDTH, height: PANEL_DEFAULT_HEIGHT }
  try {
    const raw = JSON.parse(window.localStorage.getItem(PANEL_SIZE_KEY) || 'null')
    const width = Number(raw?.width)
    const height = Number(raw?.height)
    return {
      width: Number.isFinite(width) ? clamp(width, PANEL_MIN_WIDTH, 1600) : PANEL_DEFAULT_WIDTH,
      height: Number.isFinite(height) ? clamp(height, PANEL_MIN_HEIGHT, PANEL_TALL_HEIGHT) : PANEL_DEFAULT_HEIGHT,
    }
  }
  catch {
    return { width: PANEL_DEFAULT_WIDTH, height: PANEL_DEFAULT_HEIGHT }
  }
}

function useDesktopDrawer() {
  const [desktop, setDesktop] = useState(() => {
    if (typeof window === 'undefined')
      return false
    return window.matchMedia('(min-width: 640px)').matches
  })

  useEffect(() => {
    const media = window.matchMedia('(min-width: 640px)')
    const onChange = () => setDesktop(media.matches)
    onChange()
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  return desktop
}

export default function AiAssistant() {
  const open = useAiAssistantStore(s => s.open)
  const setOpen = useAiAssistantStore(s => s.setOpen)
  const tab = useAiAssistantStore(s => s.tab)
  const setTab = useAiAssistantStore(s => s.setTab)
  const openWith = useAiAssistantStore(s => s.openWith)
  const setNotify = useAiAssistantStore(s => s.setNotify)
  const setWebSearchAvailable = useAiAssistantStore(s => s.setWebSearchAvailable)
  const hydrateChat = useAiAssistantStore(s => s.hydrateChat)
  const startChatPolling = useAiAssistantStore(s => s.startChatPolling)
  const stopChatPolling = useAiAssistantStore(s => s.stopChatPolling)

  const { toast, notify } = useNotify()
  const [config, setConfig] = useState<AiConfig | null>(null)
  const [panelSize, setPanelSize] = useState<PanelSize>(loadPanelSize)
  const [dragging, setDragging] = useState(false)
  const dragStart = useRef<{ x: number, y: number } & PanelSize | null>(null)
  const desktop = useDesktopDrawer()
  const desktopRef = useRef(desktop)
  desktopRef.current = desktop
  const deepLinkHandled = useRef(false)

  // 面板尺寸持久化：下次打开（含刷新）沿用用户调过的大小
  useEffect(() => {
    try {
      window.localStorage.setItem(PANEL_SIZE_KEY, JSON.stringify(panelSize))
    }
    catch {
      // 隐私模式 / 配额满：忽略，本次会话内仍然生效
    }
  }, [panelSize])

  const resetPanelSize = () => setPanelSize({ width: PANEL_DEFAULT_WIDTH, height: PANEL_DEFAULT_HEIGHT })

  /** @description: 桌面端在左边缘横向拖拽调宽；手机端在上边缘纵向拖高
   *  用 window 级监听而不是 setPointerCapture：抽屉的遮罩层会把这轮指针手势抢走（实测首帧后即 lostpointercapture） */
  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    dragStart.current = { x: event.clientX, y: event.clientY, ...panelSize }
    setDragging(true)
  }

  useEffect(() => {
    if (!dragging)
      return
    const onMove = (event: PointerEvent) => {
      const start = dragStart.current
      if (!start)
        return
      if (desktopRef.current) {
        const max = Math.max(PANEL_MIN_WIDTH, window.innerWidth - 24)
        setPanelSize(size => ({ ...size, width: clamp(start.width + (start.x - event.clientX), PANEL_MIN_WIDTH, max) }))
        return
      }
      const delta = ((start.y - event.clientY) / window.innerHeight) * 100
      setPanelSize(size => ({ ...size, height: clamp(start.height + delta, PANEL_MIN_HEIGHT, PANEL_TALL_HEIGHT) }))
    }
    const onEnd = () => {
      dragStart.current = null
      setDragging(false)
    }
    const { overflow, cursor } = document.body.style
    document.body.style.cursor = desktopRef.current ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
      document.body.style.cursor = cursor
      document.body.style.userSelect = ''
      document.body.style.overflow = overflow
    }
  }, [dragging])

  /** @description: 一键在「标准 / 大」之间切换（拖拽之外的快捷入口） */
  const togglePanelSize = () => {
    if (desktop) {
      const wide = clamp(window.innerWidth - 32, PANEL_DEFAULT_WIDTH + 40, PANEL_WIDE_WIDTH)
      setPanelSize(size => ({ ...size, width: size.width > PANEL_DEFAULT_WIDTH + 20 ? PANEL_DEFAULT_WIDTH : wide }))
      return
    }
    setPanelSize(size => ({ ...size, height: size.height > PANEL_DEFAULT_HEIGHT + 2 ? PANEL_DEFAULT_HEIGHT : PANEL_TALL_HEIGHT }))
  }

  const enlarged = desktop
    ? panelSize.width > PANEL_DEFAULT_WIDTH + 20
    : panelSize.height > PANEL_DEFAULT_HEIGHT + 2

  const loadConfig = useCallback(() => {
    fetch('/api/ai/status')
      .then(r => r.json())
      .then(j => setConfig(j?.data ?? null))
      .catch(() => setConfig(null))
  }, [])

  // store 里的生成动作通过 notify 提示，关抽屉也能弹 toast
  useEffect(() => {
    setNotify(notify)
    return () => setNotify(null)
  }, [notify, setNotify])

  // 客户端挂载后优先从服务端恢复 Chat 会话；服务端不可用时回退 localStorage
  useEffect(() => {
    void hydrateChat()
  }, [hydrateChat])

  // 实时多设备同步：页面打开期间定时拉服务端会话变化（新增/删除/重命名/置顶）
  useEffect(() => {
    startChatPolling()
    return () => stopChatPolling()
  }, [startChatPolling, stopChatPolling])

  useEffect(loadConfig, [loadConfig])

  // 联网搜索是否可用：注入 store，供右键「分析此条」自动带上搜索。
  useEffect(() => {
    const ws = config?.webSearch
    setWebSearchAvailable(!!ws?.enabled && (ws.provider === 'bing-rss' || !!ws.hasApiKey) && (ws.provider !== 'google-cse' || !!ws.googleCxConfigured))
  }, [config, setWebSearchAvailable])

  // 旧 `/AiModel?tab=…&title=…&url=…`（现在由服务端 302 到 `/?ai=1&…`）的深链；
  // 只在首页挂载时处理一次，避免关闭抽屉后被 URL 再次弹开。
  useEffect(() => {
    if (deepLinkHandled.current)
      return
    deepLinkHandled.current = true

    const params = new URLSearchParams(window.location.search)
    const wanted = params.get('tab')
    const title = params.get('title') || ''
    const url = params.get('url') || ''
    const hasAi = params.get('ai') === '1' || !!wanted || !!title || !!url

    if (hasAi) {
      openWith({
        tab: wanted || undefined,
        title: title || undefined,
        url: url || undefined,
      })
    }
  }, [openWith])

  const disabled = config ? !config.hasApiKey : true

  return (
    <>
      <Tooltip delay={0}>
        <Tooltip.Trigger>
          <Button
            aria-label="打开 AI 助手"
            isIconOnly
            onPress={() => setOpen(true)}
            className="fixed! right-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] sm:right-5 sm:bottom-24 z-40 size-12! rounded-full! shadow-lg"
          >
            <FaceRobot />
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content showArrow>
          AI 助手
        </Tooltip.Content>
      </Tooltip>

      <Drawer isOpen={open} onOpenChange={setOpen}>
        <Drawer.Backdrop>
          <Drawer.Content placement={desktop ? 'right' : 'bottom'}>
            <Drawer.Dialog
              className={`ai-drawer-panel ${desktop ? 'ai-drawer-panel-x' : 'ai-drawer-panel-y w-full!'}`}
              style={desktop
                ? ({ '--ai-panel-w': `${panelSize.width}px` } as React.CSSProperties)
                : ({ '--ai-panel-h': `${panelSize.height}dvh` } as React.CSSProperties)}
            >
              {/* 拖拽调大小：桌面拖左边缘（宽度）/ 手机拖上边缘（高度），双击复位 */}
              <div
                className={`ai-resize-handle ${desktop ? 'x' : 'y'}`}
                role="separator"
                aria-label="拖动调整 AI 助手大小，双击复位"
                title="拖动调整大小；双击复位"
                onPointerDown={startResize}
                onDoubleClick={resetPanelSize}
              />
              <Drawer.CloseTrigger />
              <Drawer.Header className="shrink-0 pr-12">
                <div className="ai-head-row">
                  <div className="min-w-0">
                    <Drawer.Heading>AI 助手</Drawer.Heading>
                    <div className="text-xs text-muted">
                      结果按内容哈希缓存（默认 {config?.cacheTtlDays ?? 7} 天），相同内容不会重复计费。
                    </div>
                  </div>
                  <button
                    type="button"
                    className="ai-size-btn"
                    onClick={togglePanelSize}
                    aria-label={enlarged ? '缩小 AI 助手' : '放大 AI 助手'}
                    title={(desktop ? '拖动左边缘可自由调整宽度；' : '拖动上边缘可自由调整高度；') + (enlarged ? '点这里恢复标准大小' : '点这里切换到大尺寸')}
                  >
                    {desktop ? <ArrowsExpandHorizontal width={14} /> : <ArrowsExpandVertical width={14} />}
                    {enlarged ? '缩小' : '放大'}
                  </button>
                </div>
              </Drawer.Header>

              <Drawer.Body className={`ai-drawer-body mt-3 ${tab === 'chat' ? 'chat-active' : ''}`}>
                <StatusBar config={config} />

                <div className="ai-tabs">
                  {TABS.map(item => (
                    <button
                      key={item.key}
                      type="button"
                      className={`ai-tab ${tab === item.key ? 'active' : ''}`}
                      onClick={() => setTab(item.key)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                {/* 四项能力常驻挂载、只用 display 切换：生成过程中切走再切回，进度与结果都不会丢 */}
                <div
                  className="ai-chat-panel-slot"
                  style={{
                    display: tab === 'chat' ? undefined : 'none',
                    ...(tab === 'chat' ? { flex: '1 1 0%', minHeight: 0 } : {}),
                  }}
                >
                  <ChatTab
                    disabled={disabled}
                    notify={notify}
                    webSearchAvailable={!!config?.webSearch?.enabled && (config.webSearch.provider === 'bing-rss' || !!config.webSearch.hasApiKey) && (config.webSearch.provider !== 'google-cse' || !!config.webSearch.googleCxConfigured)}
                  />
                </div>
                <div style={{ display: tab === 'summary' ? undefined : 'none' }}>
                  <SummaryTab disabled={disabled} notify={notify} />
                </div>
                <div style={{ display: tab === 'briefing' ? undefined : 'none' }}>
                  <BriefingTab disabled={disabled} notify={notify} />
                </div>
                <div style={{ display: tab === 'analyze' ? undefined : 'none' }}>
                  <AnalyzeTab disabled={disabled} notify={notify} />
                </div>
              </Drawer.Body>
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>
      </Drawer>

      {toast && <div className={`ai-toast ${toast.ok ? 'ok' : 'err'}`}>{toast.msg}</div>}
    </>
  )
}

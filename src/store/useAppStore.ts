/*
 * @Author: 白雾茫茫丶<baiwumm.com>
 * @Date: 2026-01-04 17:56:06
 * @LastEditors: 白雾茫茫丶<baiwumm.com>
 * @LastEditTime: 2026-09-26
 * @Description: 全局状态
 */

'use client'
import dayjs from 'dayjs'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import { HOT_ITEMS } from '@/enums'

type HotKeys = typeof HOT_ITEMS.valueType
export type NavPosition = 'left' | 'right' | 'top' | 'bottom'
export type DeviceKind = 'desktop' | 'mobile'

/** 单端首页配置（桌面端 / 手机端各一份，服务端共享） */
export interface HomeConfig {
  navPosition: NavPosition
  sortItems: HotKeys[]
  hiddenItems: HotKeys[]
}

/** 只覆盖传入字段的补丁 */
type HomePatch = Partial<HomeConfig>
type StorePatch = { desktop?: HomePatch, mobile?: HomePatch }

interface AppState {
  /** 每个热榜子项的最后更新时间（各浏览器自己的运行态，仍存本地） */
  UpdateTime: Partial<Record<HotKeys, number>> // 每个子项更新时间
  setUpdateTime: (time: Partial<Record<HotKeys, number>>) => void

  /** 当前时间心跳（用于驱动相对时间刷新） */
  now: number
  tick: () => void

  /** 获取相对时间文本（派生数据） */
  getRelativeTime: (key: HotKeys) => string

  /** 桌面端 / 手机端各自一套首页配置（服务端共享） */
  desktop: HomeConfig
  mobile: HomeConfig
  /** 设置面板当前编辑的是哪一端（仅本地偏好，决定 setter 写入哪一份） */
  editDevice: DeviceKind
  setEditDevice: (device: DeviceKind) => void

  /** 以下 setter 作用于 `editDevice` 对应的那一端 */
  setNavPosition: (position: NavPosition) => void
  setSortItems: (items: HotKeys[]) => void
  setHiddenItems: (items: HotKeys[]) => void
}

const NAV_POSITIONS: NavPosition[] = ['left', 'right', 'top', 'bottom']
const isNavPosition = (v: unknown): v is NavPosition => NAV_POSITIONS.includes(v as NavPosition)

function defaultHome(): HomeConfig {
  return { navPosition: 'top', sortItems: [...HOT_ITEMS.values], hiddenItems: [] }
}

/** 把服务端 / 本地的原始对象规整为合法 HomeConfig */
function normalizeHome(raw: unknown): HomeConfig {
  const asKeys = (v: unknown): HotKeys[] =>
    Array.isArray(v) ? v.filter((x): x is HotKeys => HOT_ITEMS.values.includes(x as HotKeys)) : []
  const r = (raw ?? {}) as Record<string, unknown>
  const sortItems = asKeys(r.sortItems)
  return {
    navPosition: isNavPosition(r.navPosition) ? r.navPosition : 'top',
    sortItems: sortItems.length ? sortItems : [...HOT_ITEMS.values],
    hiddenItems: asKeys(r.hiddenItems),
  }
}

/* --------------------------------------------------------------------------
 * 服务端同步
 * 排序是拖拽操作，会连续触发；这里做防抖，避免每个 drag 事件都写一次文件。
 * 补丁按「端」再按「字段」累加：400ms 内先后改排序与隐藏时，只记最后一个会把先改的丢掉。
 * -------------------------------------------------------------------------- */
let syncTimer: ReturnType<typeof setTimeout> | null = null
let pendingPatch: StorePatch = {}

/**
 * 把累积的 patch 立刻发出去。
 *
 * 为什么需要「立刻」这一路：保存是 400ms 防抖的，用户选完导航位置**马上刷新/关页**时
 * fetch 会被卸载中断 → 改动丢失。因此页面进入后台/卸载时用 sendBeacon 兜一次，保证落盘。
 */
function flushPendingPatch() {
  if (syncTimer) {
    clearTimeout(syncTimer)
    syncTimer = null
  }
  const body: StorePatch = {}
  if (pendingPatch.desktop && Object.keys(pendingPatch.desktop).length)
    body.desktop = pendingPatch.desktop
  if (pendingPatch.mobile && Object.keys(pendingPatch.mobile).length)
    body.mobile = pendingPatch.mobile
  pendingPatch = {}
  if (!Object.keys(body).length)
    return

  const payload = JSON.stringify(body)
  // sendBeacon 是「即发即忘」，不受页面卸载影响
  if (navigator.sendBeacon?.('/api/app-store', new Blob([payload], { type: 'application/json' })))
    return
  void fetch('/api/app-store', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true,
  }).catch(() => {
    // 配置保存失败不影响前端使用（下次改动会再试）
  })
}

function scheduleSync(patch: StorePatch) {
  if (typeof window === 'undefined')
    return
  // 不加「配置就绪前不许写」的闸门：服务端写入是**合并语义**、且载荷是完整列表，
  // 因此早写也不会写坏。
  pendingPatch = {
    desktop: { ...pendingPatch.desktop, ...patch.desktop },
    mobile: { ...pendingPatch.mobile, ...patch.mobile },
  }
  if (syncTimer)
    clearTimeout(syncTimer)
  syncTimer = setTimeout(flushPendingPatch, 400)
}

/**
 * 旧版配置迁移（首次部署时把浏览器里存的扁平排序/隐藏/导航位置推到服务端）。
 *
 * ⚠️ 必须在**模块初始化**时读 localStorage：persist 的 partialize 现在只保留 UpdateTime/editDevice，
 *    卡片一挂载就会 setUpdateTime，首次 set 会把旧条目重写成只含新字段 —— 之后再读就什么都没有了。
 *    另外载荷里把 sortItems 补齐成完整列表，避免只带旧的前几项把服务端已有顺序截断。
 */
function takeLegacyConfig(): StorePatch | null {
  if (typeof window === 'undefined')
    return null
  try {
    const raw = localStorage.getItem('app-store')
    if (!raw)
      return null
    const state = JSON.parse(raw)?.state
    if (!state)
      return null

    const asKeys = (v: unknown): HotKeys[] =>
      Array.isArray(v) ? v.filter((x): x is HotKeys => HOT_ITEMS.values.includes(x as HotKeys)) : []
    const sortItems = asKeys(state.sortItems)
    const hiddenItems = asKeys(state.hiddenItems)
    const navPosition = isNavPosition(state.navPosition) ? state.navPosition : undefined

    const hasLegacyConfig = !!sortItems.length || !!hiddenItems.length
    if (!hasLegacyConfig && !navPosition)
      return null

    const home: HomePatch = {
      sortItems: hasLegacyConfig ? [...sortItems, ...HOT_ITEMS.values.filter(v => !sortItems.includes(v))] : [...HOT_ITEMS.values],
      hiddenItems,
      ...(navPosition ? { navPosition } : {}),
    }
    // 旧版是全局一套 → 两端各复制一份，行为不变，之后可各自调整
    return { desktop: home, mobile: home }
  }
  catch {
    return null
  }
}

const LEGACY_CONFIG = takeLegacyConfig()

/**
 * 启动引导：读服务端配置；服务端为空且本地有旧配置时顺带迁移。
 *
 * 关键：**在模块初始化时就发出请求**（早于 React 挂载、早于各卡片抓数据的请求），
 * 否则首页并发会把浏览器每域连接占满，这个 GET 要排队数秒，页面就会先用默认顺序渲染、
 * 几秒后再跳变成用户配置。
 */
async function bootstrapAppStore(): Promise<void> {
  try {
    const response = await fetch('/api/app-store', { cache: 'no-store' })
    const json = await response.json()
    const data = json?.data
    if (!data)
      return

    if (data.exists) {
      useAppStore.setState({
        desktop: normalizeHome(data.desktop),
        mobile: normalizeHome(data.mobile),
      })
      return
    }

    // 服务端还没有配置 → 把旧版留在浏览器里的配置推上去（否则自定义顺序/隐藏项会丢）
    if (LEGACY_CONFIG) {
      await fetch('/api/app-store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(LEGACY_CONFIG),
      })
      useAppStore.setState({
        desktop: normalizeHome(LEGACY_CONFIG.desktop),
        mobile: normalizeHome(LEGACY_CONFIG.mobile),
      })
    }
  }
  catch {
    // 读取/迁移失败就用当前（默认或本地）配置，不阻塞页面
  }
}

export const useAppStore = create(
  persist<AppState>(
    (set, get) => {
      /** 把补丁写到当前 editDevice 对应的那一端，并同步到服务端 */
      const apply = (patch: HomePatch) => {
        const device = get().editDevice
        set(state => (
          device === 'desktop'
            ? { desktop: { ...state.desktop, ...patch } }
            : { mobile: { ...state.mobile, ...patch } }
        ))
        scheduleSync(device === 'desktop' ? { desktop: patch } : { mobile: patch })
      }

      return {
        /* ================= 更新时间 ================= */
        UpdateTime: {},
        setUpdateTime: (time) => {
          set(state => ({
            UpdateTime: { ...state.UpdateTime, ...time },
          }))
        },

        /* ================= 时间心跳 ================= */
        now: Date.now(),
        tick: () => {
          set({ now: Date.now() })
        },

        /* ================= 相对时间 selector ================= */
        getRelativeTime: (key) => {
          const { UpdateTime, now } = get()

          const ts = UpdateTime[key]
          if (!ts)
            return '刚刚'

          // now 只是为了建立依赖
          return dayjs(ts).fromNow()
        },

        /* ================= 首页配置（服务端共享，两端各一套） ================= */
        desktop: defaultHome(),
        mobile: defaultHome(),
        editDevice: 'desktop',
        setEditDevice: (device) => set({ editDevice: device }),

        setNavPosition: position => apply({ navPosition: position }),
        setSortItems: items => apply({ sortItems: items }),
        setHiddenItems: items => apply({ hiddenItems: items }),
      }
    },
    {
      name: 'app-store', // 用于存储在 localStorage 中的键名
      storage: createJSONStorage(() => localStorage), // 指定使用 localStorage 存储
      // 更新时间与「当前编辑哪一端」留在本地；首页配置两端都存服务端。
      partialize: state => ({
        UpdateTime: state.UpdateTime,
        editDevice: state.editDevice,
      } as any),
    },
  ),
)

// 模块初始化即发出引导请求：要抢在卡片们的并发请求之前拿到连接
if (typeof window !== 'undefined') {
  void bootstrapAppStore()
  // 页面卸载/切到后台时把防抖窗口里还没发出的改动立刻落盘（见 flushPendingPatch）
  window.addEventListener('pagehide', flushPendingPatch)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden')
      flushPendingPatch()
  })
}

/*
 * @Description: 首页配置服务端存储 —— 多浏览器、多设备共享
 *
 * 2026-09-26 起：**桌面端与手机端各存一套**（导航位置 + 排序 + 隐藏源），前端按视口选用。
 *   存储结构：{ desktop: HomeConfig, mobile: HomeConfig }
 *   兼容旧版扁平结构 { sortItems, hiddenItems, navPosition }：读取时自动迁移成两端各一份，
 *   首次写入后文件即为新结构（旧值已被复制到两端，不丢用户配置）。
 *
 * 从浏览器 localStorage 的 `app-store` 迁移而来（用户要求「放在远端，这样可以共享」）。
 * `UpdateTime`（各源最后刷新时间）属于每个浏览器自己的运行态，仍留在本地 localStorage。
 *
 * 存成项目内 `data/app-store.json`（可被 `APP_STORE_FILE` 覆盖），沿用
 * 「原子写 + 保存前 .bak」模式；该文件已加入打包器 exclude，不会进交付包。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type NavPosition = 'left' | 'right' | 'top' | 'bottom'
export type DeviceKind = 'desktop' | 'mobile'

/** 单端首页配置 */
export interface HomeConfig {
  /** 数据源导航位置 */
  navPosition: NavPosition
  /** 卡片顺序（HOT_ITEMS 的 value 列表） */
  sortItems: string[]
  /** 隐藏的源 */
  hiddenItems: string[]
}

export interface AppStoreConfig {
  desktop: HomeConfig
  mobile: HomeConfig
}

/** 写入补丁：只覆盖传入的字段 */
export type AppStorePatch = {
  desktop?: Partial<HomeConfig>
  mobile?: Partial<HomeConfig>
}

const NAV_POSITIONS: NavPosition[] = ['left', 'right', 'top', 'bottom']

function storeFile(): string {
  return process.env.APP_STORE_FILE || join(process.cwd(), 'data', 'app-store.json')
}

const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const nav = (v: unknown, fallback: NavPosition): NavPosition =>
  NAV_POSITIONS.includes(v as NavPosition) ? (v as NavPosition) : fallback

export function emptyHome(): HomeConfig {
  return { navPosition: 'top', sortItems: [], hiddenItems: [] }
}

/** @description: 读配置；文件不存在或损坏时返回 null（由调用方套默认值） */
export function readAppStore(): AppStoreConfig | null {
  try {
    const file = storeFile()
    if (!existsSync(file))
      return null
    const raw = readFileSync(file, 'utf8').trim()
    if (!raw)
      return null
    const parsed = JSON.parse(raw)

    // 旧版扁平结构 → 迁移成「两端各一份」
    const legacyFlat = !!parsed && (
      Array.isArray(parsed.sortItems)
      || Array.isArray(parsed.hiddenItems)
      || parsed.navPosition !== undefined
    )
    const legacy: HomeConfig = {
      navPosition: nav(parsed?.navPosition, 'top'),
      sortItems: list(parsed?.sortItems),
      hiddenItems: list(parsed?.hiddenItems),
    }

    const readHome = (rawHome: unknown, fallback: HomeConfig): HomeConfig => {
      if (!rawHome || typeof rawHome !== 'object')
        return { ...fallback, sortItems: [...fallback.sortItems], hiddenItems: [...fallback.hiddenItems] }
      const h = rawHome as Record<string, unknown>
      const sortItems = list(h.sortItems)
      return {
        navPosition: nav(h.navPosition, fallback.navPosition),
        sortItems: sortItems.length ? sortItems : fallback.sortItems,
        hiddenItems: Array.isArray(h.hiddenItems) ? list(h.hiddenItems) : fallback.hiddenItems,
      }
    }

    const hasDeviceShape = !!parsed?.desktop || !!parsed?.mobile
    if (!hasDeviceShape && legacyFlat) {
      return {
        desktop: legacy,
        mobile: { ...legacy, sortItems: [...legacy.sortItems], hiddenItems: [...legacy.hiddenItems] },
      }
    }

    const base = legacyFlat ? legacy : emptyHome()
    return {
      desktop: readHome(parsed?.desktop, base),
      mobile: readHome(parsed?.mobile, base),
    }
  }
  catch {
    return null
  }
}

/** @description: 合并写入（只覆盖传入的字段），返回写入后的完整配置 */
export function writeAppStore(patch: AppStorePatch): AppStoreConfig {
  const file = storeFile()
  const current = readAppStore() ?? { desktop: emptyHome(), mobile: emptyHome() }

  const merge = (home: HomeConfig, p?: Partial<HomeConfig>): HomeConfig => ({
    navPosition: p?.navPosition ?? home.navPosition,
    sortItems: p?.sortItems ?? home.sortItems,
    hiddenItems: p?.hiddenItems ?? home.hiddenItems,
  })

  const next: AppStoreConfig = {
    desktop: merge(current.desktop, patch.desktop),
    mobile: merge(current.mobile, patch.mobile),
  }

  mkdirSync(dirname(file), { recursive: true })
  if (existsSync(file))
    writeFileSync(`${file}.bak`, readFileSync(file)) // 保存前备份，与 cookies 管理一致

  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  renameSync(tmp, file) // 原子写

  return next
}

export function appStoreFilePath(): string {
  return storeFile()
}

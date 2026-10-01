/*
 * @Description: 首页配置读写（GET / POST /api/app-store）
 *  GET  → { desktop, mobile, exists }（每端 = { navPosition, sortItems, hiddenItems }）
 *  POST → { desktop?, mobile? } 合并保存，返回写入后的完整配置
 *
 * 2026-09-26 起：桌面端与手机端各存一套；旧版扁平 POST { sortItems, hiddenItems, navPosition }
 * 仍被接受（会同时写入两端），只是新前端不再使用。
 * 注意：`exists:false` 是给前端做**旧数据迁移**用的 —— 首次部署时把 localStorage 里的旧配置推上来。
 */

import { NextResponse } from 'next/server'

import { appStoreFilePath, readAppStore, writeAppStore } from '@/lib/app-store'
import type { HomeConfig } from '@/lib/app-store'
import { HOT_ITEMS } from '@/enums'
import { requireAdmin } from '@/lib/auth-guard'

export const dynamic = 'force-dynamic'

const NAV_POSITIONS = ['left', 'right', 'top', 'bottom'] as const

function withDefaults(home?: HomeConfig | null): HomeConfig {
  return {
    navPosition: home?.navPosition ?? 'top',
    sortItems: home?.sortItems?.length ? home.sortItems : [...HOT_ITEMS.values] as string[],
    hiddenItems: home?.hiddenItems ?? [],
  }
}

/** 只保留合法的已传字段（数组未传 = undefined） */
function homePatch(v: unknown): Partial<HomeConfig> | undefined {
  if (!v || typeof v !== 'object')
    return undefined
  const o = v as Record<string, unknown>
  const patch: Partial<HomeConfig> = {}
  if (Array.isArray(o.sortItems))
    patch.sortItems = o.sortItems.filter((x): x is string => typeof x === 'string')
  if (Array.isArray(o.hiddenItems))
    patch.hiddenItems = o.hiddenItems.filter((x): x is string => typeof x === 'string')
  if (NAV_POSITIONS.includes(o.navPosition as typeof NAV_POSITIONS[number]))
    patch.navPosition = o.navPosition as HomeConfig['navPosition']
  return Object.keys(patch).length ? patch : undefined
}

export async function GET() {
  const saved = readAppStore()
  return NextResponse.json({
    code: 200,
    msg: '请求成功',
    data: {
      desktop: withDefaults(saved?.desktop),
      mobile: withDefaults(saved?.mobile),
      exists: !!saved,
    },
    file: appStoreFilePath(),
    timestamp: Date.now(),
  })
}

export async function POST(request: Request) {
  const denied = await requireAdmin()
  if (denied)
    return denied
  try {
    const body = await request.json().catch(() => ({}))
    const desktop = homePatch(body?.desktop)
    const mobile = homePatch(body?.mobile)

    if (!desktop && !mobile) {
      return NextResponse.json(
        { code: 400, msg: '没有可保存的字段', data: null, timestamp: Date.now() },
        { status: 400 },
      )
    }

    const saved = writeAppStore({
      ...(desktop ? { desktop } : {}),
      ...(mobile ? { mobile } : {}),
    })
    return NextResponse.json({
      code: 200,
      msg: '已保存',
      data: { ...saved, exists: true },
      file: appStoreFilePath(),
      timestamp: Date.now(),
    })
  }
  catch (error) {
    return NextResponse.json(
      { code: 500, msg: error instanceof Error ? error.message : '保存失败', data: null, timestamp: Date.now() },
      { status: 500 },
    )
  }
}

/*
 * @Description: 后台概览（GET /api/admin/overview）——需登录
 * 只读汇总：版本 / 构建 / 运行状态 / 数据源数量 / 关键文件是否存在 / 认证信息。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { NextResponse } from 'next/server'

import { authInfo } from '@/lib/auth'
import { requireAdmin } from '@/lib/auth-guard'
import { appStoreFilePath } from '@/lib/app-store'
import { getPublicSettings } from '@/lib/ai'
import { COOKIE_SOURCES } from '@/lib/cookies-admin'
import { HOT_ITEMS } from '@/enums'
import pkg from '#/package.json'

export const dynamic = 'force-dynamic'

function readBuildId(): string | null {
  try {
    const file = join(process.cwd(), '.next', 'BUILD_ID')
    return existsSync(file) ? readFileSync(file, 'utf8').trim() : null
  }
  catch {
    return null
  }
}

function subscriptionFilePath(): string {
  return process.env.SUBSCRIPTION_FILE || join(process.cwd(), 'data', 'subscription.json')
}

export async function GET() {
  const denied = await requireAdmin()
  if (denied)
    return denied

  const info = authInfo()
  let aiConfigured = false
  try {
    const settings = getPublicSettings() as { hasApiKey?: boolean }
    aiConfigured = !!settings?.hasApiKey
  }
  catch {
    aiConfigured = false
  }

  const appStore = appStoreFilePath()
  const subscription = subscriptionFilePath()

  return NextResponse.json({
    code: 200,
    msg: '请求成功',
    data: {
      version: pkg.version,
      buildId: readBuildId(),
      node: process.version,
      uptimeSec: Math.round(process.uptime()),
      sourceCount: [...HOT_ITEMS.values].length,
      cookieSourceCount: Object.keys(COOKIE_SOURCES).length,
      aiConfigured,
      appStoreFile: appStore,
      appStoreExists: existsSync(appStore),
      subscriptionFile: subscription,
      subscriptionExists: existsSync(subscription),
      authFile: info.file,
      authUsername: info.username,
      authUpdatedAt: info.updatedAt,
    },
    timestamp: Date.now(),
  })
}

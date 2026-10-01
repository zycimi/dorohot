/*
 * @Description: cookies 管理 —— 登录态在线探测（POST /api/cookies/sources/{id}/check）
 * 文件里的 expirationDate 是导出时的浏览器快照，微博等站会对短时令牌自动续期，
 * 快照过期 ≠ 登录失效；真实有效性以本探测为准。
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { probeSource } from '@/lib/cookies-admin'
import { requireAdmin } from '@/lib/auth-guard'

export const dynamic = 'force-dynamic'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin()
  if (denied)
    return denied
  const { id } = await params
  const result = await probeSource(id)
  return NextResponse.json(result)
}

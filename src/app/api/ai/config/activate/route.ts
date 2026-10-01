/*
 * @Description: 切换当前使用的供应商（POST /api/ai/config/activate）
 *  body: { name: string }
 */

import { NextResponse } from 'next/server'

import { activateProvider, getPublicSettings } from '@/lib/ai'
import { requireAdmin } from '@/lib/auth-guard'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const denied = await requireAdmin()
  if (denied)
    return denied
  try {
    const body = await request.json().catch(() => ({}))
    const name = typeof body?.name === 'string' ? body.name.trim() : ''

    if (!name || !activateProvider(name)) {
      return NextResponse.json(
        { code: 404, msg: `未找到供应商「${name}」`, data: null, timestamp: Date.now() },
        { status: 404 },
      )
    }

    return NextResponse.json({
      code: 200,
      msg: `已切换到「${name}」`,
      data: getPublicSettings(),
      timestamp: Date.now(),
    })
  }
  catch (error) {
    return NextResponse.json(
      { code: 500, msg: error instanceof Error ? error.message : '切换失败', data: null, timestamp: Date.now() },
      { status: 500 },
    )
  }
}

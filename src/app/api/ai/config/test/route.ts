/*
 * @Description: 测试 AI 配置连通性（POST /api/ai/config/test）——用当前配置发一次最小请求
 */

import { NextResponse } from 'next/server'

import { testConnection } from '@/lib/ai'
import { requireAdmin } from '@/lib/auth-guard'

export const dynamic = 'force-dynamic'

export async function POST() {
  const denied = await requireAdmin()
  if (denied)
    return denied
  try {
    const data = await testConnection()
    return NextResponse.json({ code: 200, msg: '连接正常', data, timestamp: Date.now() })
  }
  catch (error) {
    return NextResponse.json(
      { code: 500, msg: error instanceof Error ? error.message : '连接失败', data: null, timestamp: Date.now() },
      { status: 500 },
    )
  }
}

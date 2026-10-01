/*
 * @Description: AI 配置状态（GET /api/ai/status）——只报是否已配置，不返回 Key
 */
import { NextResponse } from 'next/server'

import { getPublicSettings } from '@/lib/ai'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    code: 200,
    msg: '请求成功',
    data: getPublicSettings(),
    timestamp: Date.now(),
  })
}

/*
 * @Description: 当前登录态（GET /api/auth/session）
 * 公开接口：只回是否已登录 / 是否已初始化，供登录页与前端判断。
 */
import { NextResponse } from 'next/server'

import { authInfo, getSession } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getSession()
  const info = authInfo()
  return NextResponse.json({
    code: 200,
    msg: '请求成功',
    data: {
      authenticated: !!session,
      username: session?.username ?? null,
      initialized: info.initialized,
      updatedAt: info.updatedAt,
    },
    timestamp: Date.now(),
  })
}

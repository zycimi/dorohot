/*
 * @Description: 退出所有设备（POST /api/auth/logout-all）——吊销全部既有会话并清除本机 Cookie
 */
import { NextResponse } from 'next/server'

import { SESSION_COOKIE, revokeAllSessions, sessionCookieOptions } from '@/lib/auth'
import { requireAdmin } from '@/lib/auth-guard'

export const dynamic = 'force-dynamic'

export async function POST() {
  const denied = await requireAdmin()
  if (denied)
    return denied

  revokeAllSessions()
  const res = NextResponse.json({ code: 200, msg: '已退出所有设备', data: null, timestamp: Date.now() })
  res.cookies.set({ name: SESSION_COOKIE, value: '', ...sessionCookieOptions(), maxAge: 0 })
  return res
}

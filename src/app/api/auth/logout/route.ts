/*
 * @Description: 退出登录（POST /api/auth/logout）——清除会话 Cookie
 */
import { NextResponse } from 'next/server'

import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function POST() {
  const res = NextResponse.json({ code: 200, msg: '已退出登录', data: null, timestamp: Date.now() })
  res.cookies.set({ name: SESSION_COOKIE, value: '', ...sessionCookieOptions(), maxAge: 0 })
  return res
}

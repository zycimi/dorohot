/*
 * @Description: 首次初始化管理员（POST /api/auth/setup）
 *  仅在尚未初始化时可用；成功后即登录。
 *  注意：公网部署时应尽快初始化，否则先到者会设为管理员。
 */
import { NextResponse } from 'next/server'

import { SESSION_COOKIE, createSessionToken, isInitialized, sessionCookieOptions, setupAdmin } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const USERNAME_RE = /^[\w.@-]{3,32}$/

export async function POST(request: Request) {
  if (isInitialized()) {
    return NextResponse.json(
      { code: 409, msg: '管理员已初始化', data: null, timestamp: Date.now() },
      { status: 409 },
    )
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const username = typeof body.username === 'string' ? body.username.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''

  if (!USERNAME_RE.test(username)) {
    return NextResponse.json(
      { code: 400, msg: '用户名需 3-32 位，仅字母/数字/下划线/点/中划线', data: null, timestamp: Date.now() },
      { status: 400 },
    )
  }
  if (password.length < 6) {
    return NextResponse.json(
      { code: 400, msg: '密码至少 6 位', data: null, timestamp: Date.now() },
      { status: 400 },
    )
  }

  setupAdmin(username, password)
  const token = createSessionToken(username)
  const res = NextResponse.json({ code: 200, msg: '初始化成功', data: { username }, timestamp: Date.now() })
  if (token)
    res.cookies.set({ name: SESSION_COOKIE, value: token, ...sessionCookieOptions() })
  return res
}

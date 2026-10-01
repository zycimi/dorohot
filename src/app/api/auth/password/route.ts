/*
 * @Description: 修改管理员密码（POST /api/auth/password）
 *  { current, next } → 校验当前密码后更新；改密会吊销旧会话，并为当前设备补发新 Cookie。
 */
import { NextResponse } from 'next/server'

import { SESSION_COOKIE, changePassword, createSessionToken, getSession, sessionCookieOptions, verifyCredentials } from '@/lib/auth'
import { requireAdmin } from '@/lib/auth-guard'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const denied = await requireAdmin()
  if (denied)
    return denied

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const current = typeof body.current === 'string' ? body.current : ''
  const next = typeof body.next === 'string' ? body.next : ''

  if (!current || !next) {
    return NextResponse.json(
      { code: 400, msg: '请输入当前密码与新密码', data: null, timestamp: Date.now() },
      { status: 400 },
    )
  }
  if (next.length < 6) {
    return NextResponse.json(
      { code: 400, msg: '新密码至少 6 位', data: null, timestamp: Date.now() },
      { status: 400 },
    )
  }

  // 复用会话里的用户名做校验（单管理员）
  const username = (await getSession())?.username ?? ''
  if (!username || !verifyCredentials(username, current)) {
    return NextResponse.json(
      { code: 400, msg: '当前密码不正确', data: null, timestamp: Date.now() },
      { status: 400 },
    )
  }

  changePassword(next)
  const token = createSessionToken(username)
  const res = NextResponse.json({ code: 200, msg: '密码已更新', data: null, timestamp: Date.now() })
  if (token)
    res.cookies.set({ name: SESSION_COOKIE, value: token, ...sessionCookieOptions() })
  return res
}

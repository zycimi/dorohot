/*
 * @Description: 登录（POST /api/auth/login）
 *  { username, password } → 成功则下发 httpOnly 会话 Cookie。
 *  简单按来源 IP 限速，防止暴力破解。
 */
import { NextResponse } from 'next/server'

import { SESSION_COOKIE, createSessionToken, isInitialized, sessionCookieOptions, verifyCredentials } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const MAX_ATTEMPTS = 8
const WINDOW_MS = 10 * 60 * 1000
const attempts = new Map<string, { count: number, until: number }>()

function clientKey(request: Request): string {
  const h = request.headers
  return (h.get('x-forwarded-for') || h.get('x-real-ip') || 'local').split(',')[0].trim() || 'local'
}

export async function POST(request: Request) {
  const now = Date.now()
  const key = clientKey(request)
  const rec = attempts.get(key)
  if (rec && rec.until > now && rec.count >= MAX_ATTEMPTS) {
    return NextResponse.json(
      { code: 429, msg: '尝试过于频繁，请稍后再试', data: null, timestamp: now },
      { status: 429 },
    )
  }

  if (!isInitialized()) {
    return NextResponse.json(
      { code: 400, msg: '尚未初始化管理员账号', data: null, timestamp: now },
      { status: 400 },
    )
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const username = typeof body.username === 'string' ? body.username : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (!username || !password) {
    return NextResponse.json(
      { code: 400, msg: '请输入用户名和密码', data: null, timestamp: now },
      { status: 400 },
    )
  }

  if (!verifyCredentials(username, password)) {
    const next = rec && rec.until > now
      ? { count: rec.count + 1, until: rec.until }
      : { count: 1, until: now + WINDOW_MS }
    attempts.set(key, next)
    return NextResponse.json(
      { code: 401, msg: '用户名或密码不正确', data: null, timestamp: now },
      { status: 401 },
    )
  }

  attempts.delete(key)
  const token = createSessionToken(username)
  if (!token) {
    return NextResponse.json(
      { code: 500, msg: '会话密钥不可用，请检查配置', data: null, timestamp: now },
      { status: 500 },
    )
  }
  const res = NextResponse.json({ code: 200, msg: '登录成功', data: { username }, timestamp: now })
  res.cookies.set({ name: SESSION_COOKIE, value: token, ...sessionCookieOptions() })
  return res
}

/*
 * @Description: API 路由守卫——受保护接口在开头调用 requireAdmin()
 *
 * 用法（Node 运行时路由处理器）：
 *   const denied = await requireAdmin()
 *   if (denied) return denied
 *
 * 首页公开；以下需登录（见实现处的调用点）：
 *   /api/ai/config*、/api/ai/models、/api/ai/web-search（配置）、
 *   /api/subscription*、/api/cookies/*、/api/app-store（仅 POST 写入）、
 *   /api/admin/*、/api/auth/*（除 login / session / setup）。
 */
import { NextResponse } from 'next/server'

import { getSession } from './auth'

import type { AdminSession } from './auth'

/** @description: 已登录返回 null；未登录返回 401 JSON（调用方直接 return） */
export async function requireAdmin(): Promise<NextResponse | null> {
  const session = await getSession()
  if (session)
    return null
  return NextResponse.json(
    { code: 401, msg: '未登录或登录已过期', data: null, timestamp: Date.now() },
    { status: 401 },
  )
}

/** @description: 读取当前会话（不产生响应），供需要区分用户的路由使用 */
export async function currentSession(): Promise<AdminSession | null> {
  return getSession()
}

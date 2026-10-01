/*
 * @Description: 邮箱订阅配置（GET 读取 / POST 保存）
 *  - GET 返回脱敏配置（不回 SMTP 密码）与下次发送时间
 *  - POST 合并保存；`smtp.pass` 提交空/掩码时保留原密码
 */

import { NextResponse } from 'next/server'

import { ensureSubscriptionScheduler } from '@/lib/subscription-scheduler'
import { publicSubscription, readSubscription, subscriptionFilePath, writeSubscription } from '@/lib/subscription'
import { requireAdmin } from '@/lib/auth-guard'

export const dynamic = 'force-dynamic'

export async function GET() {
  const denied = await requireAdmin()
  if (denied)
    return denied
  ensureSubscriptionScheduler()
  return NextResponse.json({
    code: 200,
    msg: '请求成功',
    data: publicSubscription(readSubscription()),
    file: subscriptionFilePath(),
    timestamp: Date.now(),
  })
}

export async function POST(request: Request) {
  const denied = await requireAdmin()
  if (denied)
    return denied
  try {
    const body = await request.json().catch(() => ({}))
    const patch = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Record<string, unknown>

    // 首次启用且还没排期时，从保存时刻起算，避免保存后立刻发一封
    const before = readSubscription()
    if (patch.enabled === true && !before.lastSentAt)
      patch.lastSentAt = Date.now()

    const saved = writeSubscription(patch)
    ensureSubscriptionScheduler()

    return NextResponse.json({
      code: 200,
      msg: '已保存',
      data: publicSubscription(saved),
      file: subscriptionFilePath(),
      timestamp: Date.now(),
    })
  }
  catch (error) {
    return NextResponse.json(
      { code: 500, msg: error instanceof Error ? error.message : '保存失败', data: null, timestamp: Date.now() },
      { status: 500 },
    )
  }
}

/*
 * @Description: 立即发送一封订阅邮件（设置页「发送测试」用）
 */

import { NextResponse } from 'next/server'

import { isSubscriptionUnit, readSubscription, writeSubscription } from '@/lib/subscription'
import { sendSubscriptionEmail } from '@/lib/subscription-runner'
import { requireAdmin } from '@/lib/auth-guard'

export const dynamic = 'force-dynamic'
export const maxDuration = 180

export async function POST() {
  const denied = await requireAdmin()
  if (denied)
    return denied
  const config = readSubscription()
  if (!isSubscriptionUnit(config.unit) || !config.email || !config.smtp.host) {
    return NextResponse.json(
      { code: 400, msg: '请先填写收件邮箱与 SMTP 服务器并保存', data: null, timestamp: Date.now() },
      { status: 400 },
    )
  }

  try {
    const result = await sendSubscriptionEmail(config, { test: true })
    return NextResponse.json({
      code: 200,
      msg: `测试邮件已发送（${result.usedItems} 条）`,
      data: { sentAt: result.sentAt, subject: result.subject, usedSources: result.usedSources, usedItems: result.usedItems },
      timestamp: Date.now(),
    })
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    writeSubscription({ lastStatus: `测试失败 · ${message.slice(0, 200)}` })
    return NextResponse.json(
      { code: 500, msg: `发送失败：${message}`, data: null, timestamp: Date.now() },
      { status: 500 },
    )
  }
}

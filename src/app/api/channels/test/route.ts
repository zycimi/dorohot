/*
 * @Description: 渠道测试发送（POST /api/channels/test）——需管理员登录
 *  body: { id: 'feishu' | 'dingtalk' | 'wecom' }
 *  发送一条短消息，用于验证 Webhook 与签名是否正确。
 */
import { NextResponse } from 'next/server'

import { requireAdmin } from '@/lib/auth-guard'
import { channelLabel, readChannels, sendToChannels } from '@/lib/channels'
import { formatDigestTime } from '@/lib/channels'

import type { ChannelId } from '@/lib/channels'

export const dynamic = 'force-dynamic'

const IDS: ChannelId[] = ['feishu', 'dingtalk', 'wecom']

export async function POST(request: Request) {
  const denied = await requireAdmin()
  if (denied)
    return denied

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const id = (typeof body?.id === 'string' ? body.id : '') as ChannelId
  if (!IDS.includes(id)) {
    return NextResponse.json({ code: 400, msg: '未知渠道', data: null, timestamp: Date.now() }, { status: 400 })
  }

  const store = readChannels()
  if (!store[id].webhook) {
    return NextResponse.json({ code: 400, msg: `「${channelLabel(id)}」尚未配置 Webhook`, data: null, timestamp: Date.now() }, { status: 400 })
  }

  // 测试时忽略 enabled 开关：用户点「测试」就是要立刻验证这条 Webhook
  const storeForTest = { ...store, [id]: { ...store[id], enabled: true } }
  const text = `doroHot 远程接入测试 · ${formatDigestTime(Date.now())}\n如果你看到这条消息，说明「${channelLabel(id)}」配置成功。`
  const [result] = await sendToChannels(text, [id], storeForTest)

  if (!result?.ok) {
    return NextResponse.json({ code: 502, msg: result?.error || '发送失败', data: result, timestamp: Date.now() }, { status: 502 })
  }
  return NextResponse.json({ code: 200, msg: `已发送到「${channelLabel(id)}」`, data: result, timestamp: Date.now() })
}

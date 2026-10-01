/*
 * @Description: 远程接入渠道配置（GET / POST /api/channels）——需管理员登录
 *  GET  → 三家渠道的脱敏配置（只回掩码，绝不下发明文 Webhook / 密钥）
 *  POST → 合并保存（webhook / secret 传空 = 保持原值）
 */
import { NextResponse } from 'next/server'

import { requireAdmin } from '@/lib/auth-guard'
import { CHANNEL_META, channelsFilePath, maskChannels, readChannels, updateChannels } from '@/lib/channels'

import type { ChannelConfig, ChannelId } from '@/lib/channels'

export const dynamic = 'force-dynamic'

const IDS: ChannelId[] = ['feishu', 'dingtalk', 'wecom']

function snapshot() {
  const store = readChannels()
  return {
    channels: maskChannels(store),
    meta: CHANNEL_META,
    file: channelsFilePath(),
  }
}

export async function GET() {
  const denied = await requireAdmin()
  if (denied)
    return denied
  return NextResponse.json({ code: 200, msg: '请求成功', data: snapshot(), timestamp: Date.now() })
}

export async function POST(request: Request) {
  const denied = await requireAdmin()
  if (denied)
    return denied

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const patch: Partial<Record<ChannelId, Partial<ChannelConfig> & { clearWebhook?: boolean, clearSecret?: boolean }>> = {}
  for (const id of IDS) {
    const raw = body?.[id]
    if (!raw || typeof raw !== 'object')
      continue
    const r = raw as Record<string, unknown>
    patch[id] = {
      ...(typeof r.enabled === 'boolean' ? { enabled: r.enabled } : {}),
      ...(typeof r.withSubscription === 'boolean' ? { withSubscription: r.withSubscription } : {}),
      ...(typeof r.webhook === 'string' ? { webhook: r.webhook } : {}),
      ...(typeof r.secret === 'string' ? { secret: r.secret } : {}),
      ...(r.clearWebhook === true ? { clearWebhook: true } : {}),
      ...(r.clearSecret === true ? { clearSecret: true } : {}),
    }
  }

  updateChannels(patch)
  return NextResponse.json({ code: 200, msg: '已保存', data: snapshot(), timestamp: Date.now() })
}

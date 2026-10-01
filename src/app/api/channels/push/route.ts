/*
 * @Description: 推送当前热榜到已启用的远程渠道（POST /api/channels/push）——需管理员登录
 *  body: { titlesOnly?: boolean }
 *  复用订阅内容构建（collectSources + 可选 AI 简报），组装摘要后群发。
 */
import { NextResponse } from 'next/server'

import { requireAdmin } from '@/lib/auth-guard'
import { channelLabel, formatChannelDigest, readChannels, sendToChannels } from '@/lib/channels'
import { readSubscription } from '@/lib/subscription'
import { buildSubscriptionContent } from '@/lib/subscription-runner'

import type { ChannelId } from '@/lib/channels'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const IDS: ChannelId[] = ['feishu', 'dingtalk', 'wecom']

export async function POST(request: Request) {
  const denied = await requireAdmin()
  if (denied)
    return denied

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const titlesOnly = body?.titlesOnly === true

  const store = readChannels()
  const enabled = IDS.filter(id => store[id].enabled)
  if (!enabled.length) {
    return NextResponse.json({ code: 400, msg: '没有已启用的渠道', data: null, timestamp: Date.now() }, { status: 400 })
  }

  try {
    const config = readSubscription()
    const content = await buildSubscriptionContent(config)
    const text = formatChannelDigest(
      content.sources.map(s => ({ label: s.label, items: s.items })),
      content.analysis,
      Date.now(),
      { titlesOnly },
    )
    const results = await sendToChannels(text, enabled, store)
    const okCount = results.filter(r => r.ok).length
    const failed = results.filter(r => !r.ok)

    const msg = failed.length
      ? `已推送 ${okCount}/${results.length}；失败：${failed.map(f => `${channelLabel(f.id)}（${f.error}）`).join('；')}`
      : `已推送到 ${okCount} 个渠道`

    return NextResponse.json(
      { code: okCount ? 200 : 502, msg, data: { results, usedSources: content.usedSources, usedItems: content.usedItems }, timestamp: Date.now() },
      { status: okCount ? 200 : 502 },
    )
  }
  catch (error) {
    return NextResponse.json(
      { code: 500, msg: error instanceof Error ? error.message : '推送失败', data: null, timestamp: Date.now() },
      { status: 500 },
    )
  }
}

/*
 * @Description: AI 历史记录读写（GET / DELETE /api/ai/history）
 *  GET    ?feature=item|summary|briefing|analyze（可选）→ 列表
 *  DELETE ?id=xxx        → 删除一条
 *  DELETE ?feature=xxx   → 清空该类
 *
 * 记录由各生成路由**自动写入**，前端不需要 POST。
 */
import { NextResponse } from 'next/server'

import { clearHistory, historyFilePath, listHistory, removeHistory } from '@/lib/ai-history'

import type { AiFeature } from '@/lib/ai-history'

export const dynamic = 'force-dynamic'

const FEATURES: AiFeature[] = ['item', 'summary', 'briefing', 'analyze']

function asFeature(value: string | null): AiFeature | undefined {
  return value && FEATURES.includes(value as AiFeature) ? (value as AiFeature) : undefined
}

export async function GET(request: Request) {
  const feature = asFeature(new URL(request.url).searchParams.get('feature'))
  const entries = listHistory(feature)
  return NextResponse.json({
    code: 200,
    msg: '请求成功',
    data: entries,
    file: historyFilePath(),
    timestamp: Date.now(),
  })
}

export async function DELETE(request: Request) {
  const params = new URL(request.url).searchParams
  const id = params.get('id')
  const feature = asFeature(params.get('feature'))

  if (id) {
    const ok = removeHistory(id)
    return NextResponse.json(
      { code: ok ? 200 : 404, msg: ok ? '已删除' : '未找到该记录', data: null, timestamp: Date.now() },
      { status: ok ? 200 : 404 },
    )
  }

  const removed = clearHistory(feature)
  return NextResponse.json({ code: 200, msg: `已清空 ${removed} 条`, data: null, timestamp: Date.now() })
}

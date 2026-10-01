/*
 * @Description: AI 逐条摘要（POST /api/ai/summarize）
 *  body: { alias?: string, items?: AiSourceItem[], limit?: number }
 *  - 传 alias 时由服务端抓取该源；也可直接传 items
 */
import { NextResponse } from 'next/server'

import { addHistory } from '@/lib/ai-history'
import { fetchSource, summarizeItems } from '@/lib/ai'

import type { AiSourceItem } from '@/lib/ai'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const limit = Math.min(Math.max(Number(body?.limit) || 10, 1), 30)

    let items: AiSourceItem[] = []
    if (Array.isArray(body?.items) && body.items.length) {
      items = body.items.slice(0, limit).map((it: any) => ({
        title: String(it?.title ?? '').trim(),
        url: it?.url,
        desc: it?.desc,
        source: it?.source,
      })).filter((it: AiSourceItem) => it.title)
    }
    else if (typeof body?.alias === 'string' && body.alias) {
      items = (await fetchSource(body.alias)).slice(0, limit).map(it => ({ ...it, source: body.label || body.alias }))
    }

    if (!items.length) {
      return NextResponse.json({ code: 404, msg: '未获取到可摘要的条目', data: [], timestamp: Date.now() }, { status: 404 })
    }

    const { rows, usage } = await summarizeItems(items)
    const failed = rows.filter(d => d.error).length

    // 服务端自动记历史（前端不需要 POST），带上本次消耗
    const sourceName = (typeof body?.label === 'string' && body.label) || (typeof body?.alias === 'string' ? body.alias : '自定义条目')
    addHistory({
      feature: 'summary',
      label: `${sourceName} · 前 ${items.length} 条`,
      rows: rows.filter(d => d.summary).map(d => ({ title: d.title, summary: d.summary, url: d.url })),
      note: failed ? `${failed} 条失败` : undefined,
      tokens: usage,
    })

    return NextResponse.json({
      code: 200,
      msg: failed ? `完成，其中 ${failed} 条失败` : '请求成功',
      data: rows,
      tokens: usage,
      timestamp: Date.now(),
    })
  }
  catch (error) {
    return NextResponse.json(
      { code: 500, msg: error instanceof Error ? error.message : '生成失败', data: [], timestamp: Date.now() },
      { status: 500 },
    )
  }
}

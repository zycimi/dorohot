/*
 * @Description: AI 每日简报（POST /api/ai/briefing）
 *  body: { aliases?: string[], perSource?: number }
 *  - 默认聚合全部数据源；服务端并发抓取后交给模型综述
 */
import { NextResponse } from 'next/server'

import { addHistory } from '@/lib/ai-history'
import { buildBriefing, collectSources } from '@/lib/ai'
import { HOT_ITEMS } from '@/enums'

export const dynamic = 'force-dynamic'
export const maxDuration = 600

export async function POST(request: Request) {
  const started = Date.now()
  try {
    const body = await request.json().catch(() => ({}))
    const perSource = Math.min(Math.max(Number(body?.perSource) || 8, 3), 20)

    const aliases: string[] = Array.isArray(body?.aliases) && body.aliases.length
      ? body.aliases.filter((a: unknown): a is string => typeof a === 'string')
      : [...HOT_ITEMS.values]

    const sources = await collectSources(aliases, { perSource })
    const nonEmpty = sources.filter(s => s.items.length)

    if (!nonEmpty.length) {
      return NextResponse.json(
        { code: 404, msg: '所选数据源均未返回内容', data: null, timestamp: Date.now() },
        { status: 404 },
      )
    }

    const result = await buildBriefing(nonEmpty)

    addHistory({
      feature: 'briefing',
      label: `${result.usedSources} 源 · ${result.usedItems} 条`,
      text: result.text,
      note: result.cached ? '命中缓存' : undefined,
      tokens: result.usage,
    })

    return NextResponse.json({
      code: 200,
      msg: '请求成功',
      data: {
        ...result,
        elapsedMs: Date.now() - started,
        // 便于前端展示「本期依据了哪些源」
        sources: nonEmpty.map(s => ({ label: s.label, alias: s.alias, count: s.items.length })),
        skipped: sources.filter(s => !s.items.length).map(s => s.label),
      },
      timestamp: Date.now(),
    })
  }
  catch (error) {
    return NextResponse.json(
      { code: 500, msg: error instanceof Error ? error.message : '生成失败', data: null, timestamp: Date.now() },
      { status: 500 },
    )
  }
}

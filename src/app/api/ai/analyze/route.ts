/*
 * @Description: AI 趋势分析（POST /api/ai/analyze）
 *  body: { alias: string, label?: string, focus?: string, limit?: number }
 */
import { NextResponse } from 'next/server'

import { addHistory } from '@/lib/ai-history'
import { analyze, fetchSource, sourceLabel } from '@/lib/ai'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const alias = typeof body?.alias === 'string' ? body.alias : ''
    if (!alias) {
      return NextResponse.json({ code: 400, msg: '缺少 alias 参数', data: null, timestamp: Date.now() }, { status: 400 })
    }

    const limit = Math.min(Math.max(Number(body?.limit) || 20, 5), 50)
    const label = body?.label || sourceLabel(alias)

    const items = (await fetchSource(alias)).slice(0, limit)
    if (!items.length) {
      return NextResponse.json({ code: 404, msg: '该数据源当前没有内容', data: null, timestamp: Date.now() }, { status: 404 })
    }

    const focus = typeof body?.focus === 'string' ? body.focus.trim() : undefined
    const result = await analyze(items, { label, focus })

    addHistory({
      feature: 'analyze',
      label: `${label}${focus ? ` · ${focus}` : ''} · ${result.usedItems} 条`,
      text: result.text,
      note: result.cached ? '命中缓存' : undefined,
      tokens: result.usage,
    })

    return NextResponse.json({ code: 200, msg: '请求成功', data: { ...result, label, alias }, timestamp: Date.now() })
  }
  catch (error) {
    return NextResponse.json(
      { code: 500, msg: error instanceof Error ? error.message : '生成失败', data: null, timestamp: Date.now() },
      { status: 500 },
    )
  }
}

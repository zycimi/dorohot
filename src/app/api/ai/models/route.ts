/*
 * @Description: 拉取当前 API Key 可用的模型列表（POST /api/ai/models）
 *  body: { baseUrl?, apiType?, headers?, apiKey? }
 *  - 全部字段可选：未填的项沿用已保存配置，因此「填完 Key 还没保存」也能先拉一次
 *  - apiKey 为空或仍是掩码时，自动使用已保存的 Key
 */

import { NextResponse } from 'next/server'

import { listModels } from '@/lib/ai'
import { requireAdmin } from '@/lib/auth-guard'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: Request) {
  const denied = await requireAdmin()
  if (denied)
    return denied
  try {
    const body = await request.json().catch(() => ({}))
    const str = (value: unknown) => (typeof value === 'string' ? value : undefined)

    const data = await listModels({
      baseUrl: str(body?.baseUrl),
      apiType: str(body?.apiType),
      headers: str(body?.headers),
      apiKey: str(body?.apiKey),
    })

    return NextResponse.json({
      code: 200,
      msg: `获取到 ${data.models.length} 个模型`,
      data,
      timestamp: Date.now(),
    })
  }
  catch (error) {
    return NextResponse.json(
      { code: 500, msg: error instanceof Error ? error.message : '拉取失败', data: null, timestamp: Date.now() },
      { status: 500 },
    )
  }
}

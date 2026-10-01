/*
 * @Description: AI 配置读取/保存/删除（/api/ai/config）
 *  GET    → 当前生效配置（Key 以掩码返回，绝不下发明文）
 *  POST   → 保存 Base URL / API Key / 模型到配置文件
 *  DELETE → ?name=xxx 删除一个已保存的供应商（不可恢复）
 */

import { NextResponse } from 'next/server'

import { deleteProvider, getPublicSettings, saveProvider } from '@/lib/ai'
import { requireAdmin } from '@/lib/auth-guard'

export const dynamic = 'force-dynamic'

export async function GET() {
  const denied = await requireAdmin()
  if (denied)
    return denied
  return NextResponse.json({ code: 200, msg: '请求成功', data: getPublicSettings(), timestamp: Date.now() })
}

export async function POST(request: Request) {
  const denied = await requireAdmin()
  if (denied)
    return denied
  try {
    const body = await request.json().catch(() => ({}))
    const str = (value: unknown) => (typeof value === 'string' ? value : undefined)

    saveProvider({
      name: str(body?.name),
      baseUrl: str(body?.baseUrl),
      headers: str(body?.headers),
      apiType: str(body?.apiType),
      apiKey: str(body?.apiKey),
      model: str(body?.model),
      modelModes: Array.isArray(body?.modelModes) ? body.modelModes : str(body?.modelModes),
    })
    return NextResponse.json({ code: 200, msg: '已保存供应商', data: getPublicSettings(), timestamp: Date.now() })
  }
  catch (error) {
    return NextResponse.json(
      { code: 500, msg: error instanceof Error ? error.message : '保存失败', data: null, timestamp: Date.now() },
      { status: 500 },
    )
  }
}

export async function DELETE(request: Request) {
  const denied = await requireAdmin()
  if (denied)
    return denied
  try {
    const name = (new URL(request.url).searchParams.get('name') || '').trim()
    if (!name) {
      return NextResponse.json(
        { code: 400, msg: '缺少供应商名字', data: null, timestamp: Date.now() },
        { status: 400 },
      )
    }

    const result = deleteProvider(name)
    if (!result.ok) {
      return NextResponse.json(
        { code: 404, msg: `未找到供应商「${name}」`, data: null, timestamp: Date.now() },
        { status: 404 },
      )
    }

    return NextResponse.json({
      code: 200,
      msg: `已删除供应商「${name}」`,
      data: getPublicSettings(),
      timestamp: Date.now(),
    })
  }
  catch (error) {
    return NextResponse.json(
      { code: 500, msg: error instanceof Error ? error.message : '删除失败', data: null, timestamp: Date.now() },
      { status: 500 },
    )
  }
}

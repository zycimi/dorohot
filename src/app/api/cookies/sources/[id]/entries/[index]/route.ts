/*
 * @Description: cookies 管理 —— 单条 cookie：PUT 编辑 / DELETE 删除
 * （/api/cookies/sources/{id}/entries/{index}；新增走 POST .../entries）
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { fileMtime, getSource, publicEntry, readEntries, writeEntries } from '@/lib/cookies-admin'
import type { CookieEntry } from '@/lib/cookies-admin'
import { requireAdmin } from '@/lib/auth-guard'

export const dynamic = 'force-dynamic'

/** PUT：编辑 { name?, value?, domain?, path?, expiresAt? } */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string, index: string }> }) {
  const denied = await requireAdmin()
  if (denied)
    return denied
  try {
    const { id, index } = await params
    const src = getSource(id)
    const idx = Number(index)
    const entries = readEntries(src)
    if (!entries[idx])
      return NextResponse.json({ error: `条目 #${idx} 不存在（文件可能已变更，请刷新）` }, { status: 404 })
    const body = await req.json().catch(() => ({}))
    const cur = entries[idx] as CookieEntry
    if (body.name !== undefined) cur.name = String(body.name).trim()
    if (body.value !== undefined) cur.value = String(body.value)
    if (body.domain !== undefined) cur.domain = body.domain
    if (body.path !== undefined) cur.path = body.path
    if (body.expiresAt !== undefined) {
      if (body.expiresAt === null || body.expiresAt === '') {
        delete cur.expirationDate
        cur.session = true
      }
      else {
        const t = Date.parse(body.expiresAt)
        if (Number.isNaN(t))
          return NextResponse.json({ error: `过期时间无法解析: ${body.expiresAt}` }, { status: 400 })
        cur.expirationDate = Math.floor(t / 1000)
        cur.session = false
      }
    }
    cur.updatedAt = new Date().toISOString()
    entries[idx] = cur
    writeEntries(src, entries)
    return NextResponse.json({ ok: true, entry: publicEntry(cur, idx, fileMtime(src)) })
  }
  catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}

/** DELETE：删除单条 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string, index: string }> }) {
  const denied = await requireAdmin()
  if (denied)
    return denied
  try {
    const { id, index } = await params
    const src = getSource(id)
    const idx = Number(index)
    const entries = readEntries(src)
    if (!entries[idx])
      return NextResponse.json({ error: `条目 #${idx} 不存在（文件可能已变更，请刷新）` }, { status: 404 })
    const removed = entries.splice(idx, 1)
    writeEntries(src, entries)
    return NextResponse.json({ ok: true, removed: (removed[0] as CookieEntry).name, total: entries.length })
  }
  catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}

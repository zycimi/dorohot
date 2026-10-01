/*
 * @Description: cookies 管理 —— 新增单条 cookie（POST /api/cookies/sources/{id}/entries，同名同域则覆盖）
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { entryKey, fileMtime, getSource, normalizeEntry, publicEntry, readEntries, writeEntries } from '@/lib/cookies-admin'
import type { CookieEntry } from '@/lib/cookies-admin'
import { requireAdmin } from '@/lib/auth-guard'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin()
  if (denied)
    return denied
  try {
    const { id } = await params
    const src = getSource(id)
    const body = await req.json().catch(() => ({}))
    const now = new Date().toISOString()
    const entry = normalizeEntry({ domain: new URL(src.site).hostname, path: '/', session: true, ...body }, now)
    if (!entry)
      return NextResponse.json({ error: 'name 必填' }, { status: 400 })
    const entries = readEntries(src)
    const key = entryKey(entry)
    const i = entries.findIndex(e => entryKey(e as CookieEntry) === key)
    if (i >= 0)
      entries[i] = entry
    else
      entries.push(entry)
    writeEntries(src, entries)
    const idx = i >= 0 ? i : entries.length - 1
    return NextResponse.json({ ok: true, entry: publicEntry(entry, idx, fileMtime(src)), total: entries.length })
  }
  catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}

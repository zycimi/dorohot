/*
 * @Description: cookies 管理 —— 单个数据源：GET 读条目 / POST 导入（/api/cookies/sources/{id}）
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { COOKIE_SOURCES, entryKey, fileMtime, getSource, parseImportText, publicEntry, readEntries, writeEntries } from '@/lib/cookies-admin'
import type { CookieEntry } from '@/lib/cookies-admin'
import { requireAdmin } from '@/lib/auth-guard'

export const dynamic = 'force-dynamic'

/** GET：条目列表 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin()
  if (denied)
    return denied
  try {
    const { id } = await params
    const src = getSource(id)
    const entries = readEntries(src)
    const mtime = fileMtime(src)
    return NextResponse.json({
      file: src.file,
      backup: `${src.file}.bak`,
      entries: entries.map((e, i) => publicEntry(e as CookieEntry, i, mtime)),
    })
  }
  catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}

/** POST：导入 { text, mode: 'merge' | 'replace' } */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin()
  if (denied)
    return denied
  try {
    const { id } = await params
    const src = getSource(id)
    const body = await req.json().catch(() => ({}))
    const { format, entries } = parseImportText(body.text)
    const mode = body.mode === 'replace' ? 'replace' : 'merge'

    let current = readEntries(src)
    if (mode === 'replace') {
      current = entries
    }
    else {
      // 合并：name(+domain) 相同则覆盖，否则追加
      const map = new Map(current.map(e => [entryKey(e as CookieEntry), e]))
      for (const e of entries) map.set(entryKey(e), e)
      current = [...map.values()]
    }
    writeEntries(src, current)
    return NextResponse.json({ ok: true, format, mode, imported: entries.length, total: current.length })
  }
  catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}

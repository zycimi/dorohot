/*
 * @Description: cookies 管理 —— 数据源列表（/api/cookies/sources）
 */

import { existsSync } from 'node:fs'

import { NextResponse } from 'next/server'

import { COOKIE_SOURCES, fileMtime, readEntries } from '@/lib/cookies-admin'
import { requireAdmin } from '@/lib/auth-guard'

export const dynamic = 'force-dynamic'

export async function GET() {
  const denied = await requireAdmin()
  if (denied)
    return denied
  const list = Object.entries(COOKIE_SOURCES).map(([id, s]) => {
    const exists = existsSync(s.file)
    let count = 0
    let mtime: string | null = null
    if (exists) {
      try {
        count = readEntries(s).length
      }
      catch {
        count = -1
      }
      mtime = new Date(fileMtime(s)).toISOString()
    }
    return { id, label: s.label, file: s.file, site: s.site, note: s.note, exists, count, mtime }
  })
  return NextResponse.json(list)
}

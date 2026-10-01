/*
 * @Description: 微博 - 关注流（自建数据源）
 *
 * 关注博主的新微博（关注流）。规则：优先取最近 3 小时内的（最多 20 条）；
 * 若 3 小时内不足 20 条，则扩充到 6 小时窗口，直到凑满 20 条或抓尽。
 * 排序按发布时间倒序（最新在前），热度展示用点赞数。
 */
import { NextResponse } from 'next/server'

import { responseError, responseSuccess } from '@/lib/utils'
import { fetchWeiboFriends } from '@/lib/weibo'

const TARGET = 20
const WINDOW_3H = 3 * 3_600_000
const WINDOW_6H = 6 * 3_600_000

export async function GET() {
  try {
    const now = Date.now()
    const all = await fetchWeiboFriends() // 内部已按 6h 窗口过滤，含内部 ts 字段

    // 先取 3h 内
    let items = all.filter(v => now - v.ts <= WINDOW_3H)
    if (items.length < TARGET) {
      // 扩充到 6h 补足差额
      const rest = all
        .filter(v => now - v.ts > WINDOW_3H && now - v.ts <= WINDOW_6H)
        .slice(0, TARGET - items.length)
      items = [...items, ...rest]
    }
    items = items.slice(0, TARGET)

    // 输出时剔除内部 ts 字段
    const out = items.map(({ ts, ...rest }) => rest)
    return NextResponse.json(responseSuccess(out))
  }
  catch (err) {
    console.error('[weibo-friends route]', err instanceof Error ? err.message : err)
    return NextResponse.json(responseError)
  }
}

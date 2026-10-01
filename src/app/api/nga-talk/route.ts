/*
 * @Description: NGA玩家社区 - 杂谈/国际/历史 热帖榜（自建数据源）
 *
 * 聚合 网事杂谈(-7, 水区)、国际新闻(843)、历史研究(847) 三个板块，
 * 按回复数取热度前 20。共享逻辑见 @/lib/nga。
 */
import { NextResponse } from 'next/server'

import { responseError, responseSuccess } from '@/lib/utils'
import { fetchNgaHot } from '@/lib/nga'

const FIDS = ['-7', '843', '847']
const TOP_N = 20

export async function GET() {
  try {
    const items = await fetchNgaHot(FIDS, TOP_N)
    return NextResponse.json(responseSuccess(items))
  }
  catch (err) {
    console.error('[nga-talk route]', err instanceof Error ? err.message : err)
    return NextResponse.json(responseError)
  }
}

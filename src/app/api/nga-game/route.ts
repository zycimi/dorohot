/*
 * @Description: NGA玩家社区 - 手综/吃瓜 热帖榜（自建数据源）
 *
 * 聚合 手机 网页游戏综合讨论(428, 手综)、手游瓜事件(-61285727, 吃瓜)
 * 两个板块，按回复数取热度前 20。共享逻辑见 @/lib/nga。
 */
import { NextResponse } from 'next/server'

import { responseError, responseSuccess } from '@/lib/utils'
import { fetchNgaHot } from '@/lib/nga'

const FIDS = ['428', '-61285727']
const TOP_N = 20

export async function GET() {
  try {
    const items = await fetchNgaHot(FIDS, TOP_N)
    return NextResponse.json(responseSuccess(items))
  }
  catch (err) {
    console.error('[nga-game route]', err instanceof Error ? err.message : err)
    return NextResponse.json(responseError)
  }
}

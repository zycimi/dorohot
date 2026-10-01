/*
 * @Description: 小黑盒 - 社区热帖榜（自建数据源）
 *
 * 默认取「盒友杂谈」板块（社区综合大版）按官方智能排序的前 20 条。
 * 共享逻辑见 @/lib/xhh（含必带的 hkey 签名算法，逐字移植自上游参考实现）。
 * 该接口匿名可用，因此不读 cookie 文件。
 */
import { NextResponse } from 'next/server'

import { responseError, responseSuccess } from '@/lib/utils'
import { fetchXhhHot } from '@/lib/xhh'

const TOP_N = 20

export async function GET() {
  try {
    const items = await fetchXhhHot(undefined, TOP_N)
    if (!items.length) {
      console.error('[xhh route] 接口返回 0 条')
      return NextResponse.json(responseError)
    }
    return NextResponse.json(responseSuccess(items))
  }
  catch (err) {
    console.error('[xhh route]', err instanceof Error ? err.message : err)
    return NextResponse.json(responseError)
  }
}

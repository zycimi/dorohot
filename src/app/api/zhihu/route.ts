/*
 * @Author: 白雾茫茫丶<baiwumm.com>
 * @Date: 2024-05-14 09:28:41
 * @LastEditors: 白雾茫茫丶<baiwumm.com>
 * @LastEditTime: 2026-07-31 17:38:21
 * @Description: 知乎-热榜
 */
import { NextResponse } from 'next/server'

import { RESPONSE } from '@/enums'
import { cookieHeaderOfSource } from '@/lib/site-auth'
import { responseError, responseSuccess } from '@/lib/utils'

import type { HotListItem } from '@/types'

export async function GET() {
  // 官方 url
  const url = 'https://api.zhihu.com/topstory/hot-list'
  try {
    // 有知乎 cookie 就带上（z_c0 等），降低被风控的概率；没有则匿名请求
    const cookie = cookieHeaderOfSource('zhihu')
    const response = await fetch(url, {
      headers: {
        'Referer': 'https://www.zhihu.com/hot',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        ...(cookie ? { Cookie: cookie } : {}),
      },
    })
    if (!response.ok) {
      // 如果请求失败，抛出错误，不进行缓存
      throw new Error(`${RESPONSE.label(RESPONSE.ERROR)}：知乎-热榜`)
    }
    // 得到请求体
    const responseBody = await response.json()
    // 处理数据
    if (responseBody.data) {
      const result: HotListItem[] = responseBody.data.map((v) => {
        return {
          id: v.id,
          title: v.target.title,
          pic: v.children[0].thumbnail,
          hot: parseInt(v.detail_text.replace(/\D/g, '')) * 10000,
          url: `https://www.zhihu.com/question/${v.card_id.replace('Q_', '')}`,
          mobileUrl: `https://www.zhihu.com/question/${v.card_id.replace('Q_', '')}`,
        }
      })
      return NextResponse.json(responseSuccess(result))
    }
    return NextResponse.json(responseSuccess())
  }
  catch {
    return NextResponse.json(responseError)
  }
}

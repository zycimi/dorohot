/*
 * @Author: 白雾茫茫丶<baiwumm.com>
 * @Description: 东方财富-7×24财经快讯（公开接口，无需登录）
 */
import { NextResponse } from 'next/server'

import { RESPONSE } from '@/enums'
import { responseError, responseSuccess } from '@/lib/utils'

import type { HotListItem } from '@/types'

/** 快讯正文偶尔带 HTML 片段，统一清洗 */
function strip(s: unknown): string {
  return String(s ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function GET() {
  // 官方 url（fastColumn=102 为 7×24 全部快讯）
  const url = 'https://np-weblist.eastmoney.com/comm/web/getFastNewsList?client=web&biz=web_724&fastColumn=102&sortEnd=&pageSize=30&req_trace=1'
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Referer': 'https://kuaixun.eastmoney.com/',
      },
    })
    if (!response.ok) {
      // 如果请求失败，抛出错误，不进行缓存
      throw new Error(`${RESPONSE.label(RESPONSE.ERROR)}：东方财富-7×24快讯`)
    }
    const responseBody = await response.json()
    const list = responseBody?.data?.fastNewsList || []
    const result: HotListItem[] = list
      .map((v: any) => {
        const title = strip(v.title) || strip(v.summary).slice(0, 40)
        return {
          id: v.code,
          title,
          desc: strip(v.summary).slice(0, 60),
          tip: String(v.showTime || '').slice(11, 16), // HH:mm
          url: `https://finance.eastmoney.com/a/${v.code}.html`,
          mobileUrl: `https://finance.eastmoney.com/a/${v.code}.html`,
        }
      })
      .filter((v: HotListItem) => v.title)
    return NextResponse.json(responseSuccess(result))
  }
  catch {
    return NextResponse.json(responseError)
  }
}

/*
 * @Author: 白雾茫茫丶<baiwumm.com>
 * @Description: 量子位-AI资讯（WordPress REST 接口，公开无需登录）
 */
import { NextResponse } from 'next/server'

import { RESPONSE } from '@/enums'
import { responseError, responseSuccess } from '@/lib/utils'

import type { HotListItem } from '@/types'

/** 标题/摘要带 HTML 与实体，清洗成纯文本 */
function strip(s: unknown): string {
  return String(s ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#8217;|&#039;|&apos;/g, '\'')
    .replace(/&#8211;/g, '–')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/\s+/g, ' ')
    .trim()
}

export async function GET() {
  // 官方 url（WordPress REST；_fields 只取需要的字段）
  const url = 'https://www.qbitai.com/wp-json/wp/v2/posts?per_page=20&_fields=id,date,link,title,excerpt'
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Referer': 'https://www.qbitai.com/',
      },
    })
    if (!response.ok) {
      // 如果请求失败，抛出错误，不进行缓存
      throw new Error(`${RESPONSE.label(RESPONSE.ERROR)}：量子位`)
    }
    const responseBody = await response.json()
    const list: any[] = Array.isArray(responseBody) ? responseBody : []
    const result: HotListItem[] = list
      .map((v: any) => {
        return {
          id: v.id,
          title: strip(v?.title?.rendered),
          desc: strip(v?.excerpt?.rendered).slice(0, 60),
          tip: String(v.date || '').slice(11, 16), // HH:mm
          url: v.link,
          mobileUrl: v.link,
        }
      })
      .filter((v: HotListItem) => v.title)
    return NextResponse.json(responseSuccess(result))
  }
  catch {
    return NextResponse.json(responseError)
  }
}

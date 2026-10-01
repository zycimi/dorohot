/*
 * @Author: 白雾茫茫丶<baiwumm.com>
 * @Description: 金十数据-财经快讯（公开接口，无需登录；需过滤广告位与清洗 HTML）
 */
import { NextResponse } from 'next/server'

import { RESPONSE } from '@/enums'
import { responseError, responseSuccess } from '@/lib/utils'

import type { HotListItem } from '@/types'

/** 快讯正文是 HTML 片段，清洗成纯文本 */
function strip(s: unknown): string {
  return String(s ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function GET() {
  // 官方 url（channel=-8200 为全部快讯）
  const url = 'https://flash-api.jin10.com/get_flash_list?channel=-8200&vip=1'
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Referer': 'https://www.jin10.com/',
        // 公开 App 标识头，缺省会被拒绝
        'x-app-id': 'bVBF4FyRTn5NJF5n',
        'x-version': '1.0.0',
      },
    })
    if (!response.ok) {
      // 如果请求失败，抛出错误，不进行缓存
      throw new Error(`${RESPONSE.label(RESPONSE.ERROR)}：金十数据-快讯`)
    }
    const responseBody = await response.json()
    const list: any[] = responseBody?.data || []
    const result: HotListItem[] = list
      .filter((v: any) => !v?.extras?.ad) // 过滤广告位（VIP 促销、活动推广等）
      .map((v: any) => {
        const title = strip(v?.data?.title) || strip(v?.data?.content)
        return {
          id: v.id,
          title: title.slice(0, 100),
          desc: v.important === 1 ? '重要快讯' : '',
          tip: String(v.time || '').slice(11, 16), // HH:mm
          url: `https://flash.jin10.com/detail/${v.id}`,
          mobileUrl: `https://flash.jin10.com/detail/${v.id}`,
        }
      })
      .filter((v: HotListItem) => v.title)
    return NextResponse.json(responseSuccess(result))
  }
  catch {
    return NextResponse.json(responseError)
  }
}

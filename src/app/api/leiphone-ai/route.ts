/*
 * @Author: 白雾茫茫丶<baiwumm.com>
 * @Description: 雷峰网-人工智能（AI 频道，页面服务端渲染，cheerio 解析）
 */
import * as cheerio from 'cheerio'
import { NextResponse } from 'next/server'

import { RESPONSE } from '@/enums'
import { responseError, responseSuccess } from '@/lib/utils'

import type { HotListItem } from '@/types'

/** 时间样式 "09月10日 19:00" → "09-10 19:00" */
function normalizeTime(s: string): string {
  return s.replace(/(\d{2})月(\d{2})日/, '$1-$2').trim()
}

// 注意：不要用完整 Chrome UA（含 AppleWebKit/KHTML/Gecko/Safari 全串）——雷峰网 WAF 会直接 403，
// 简短 UA 可正常访问（2026-09-12 实测）
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125.0'

/** 雷峰网 WAF 对高频请求会临时 403，这里做 60 秒内存缓存 + 失败重试一次 */
const CACHE_TTL = 60_000
let cache: { ts: number, data: HotListItem[] } | null = null

async function fetchPage(): Promise<string> {
  const headers = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Referer': 'https://www.leiphone.com/',
  }
  for (let i = 0; i < 2; i++) {
    const response = await fetch('https://www.leiphone.com/category/ai', { headers })
    if (response.ok)
      return response.text()
    if (i === 0)
      await new Promise(r => setTimeout(r, 900)) // 被限流时稍等重试一次
  }
  throw new Error(`${RESPONSE.label(RESPONSE.ERROR)}：雷峰网-AI（上游拒绝访问）`)
}

export async function GET() {
  try {
    if (cache && Date.now() - cache.ts < CACHE_TTL)
      return NextResponse.json(responseSuccess(cache.data))

    const html = await fetchPage()
    const $ = cheerio.load(html)
    const result: HotListItem[] = []
    $('.lph-pageList .list li').each((_, el) => {
      const $el = $(el)
      const $a = $el.find('h3 a.headTit').first()
      const title = ($a.attr('title') || $a.text()).trim()
      const link = ($a.attr('href') || '').trim()
      if (!title || !link)
        return
      const desc = $el.find('.des').text().trim()
      const author = $el.find('.msg a.aut').text().trim()
      const time = normalizeTime($el.find('.msg .time').text())
      // 形如 .../category/ai/xxxx.html → 用文件段做 id
      const id = link.split('/').pop()?.replace(/\.html$/, '') || link
      result.push({
        id,
        title,
        desc: [author, desc].filter(Boolean).join(' · ').slice(0, 70),
        tip: time,
        url: link,
        mobileUrl: link,
      })
    })
    if (result.length)
      cache = { ts: Date.now(), data: result }
    return NextResponse.json(responseSuccess(result))
  }
  catch {
    // 上游失败时，若有旧缓存则降级返回，避免卡片空窗
    if (cache)
      return NextResponse.json(responseSuccess(cache.data))
    return NextResponse.json(responseError)
  }
}

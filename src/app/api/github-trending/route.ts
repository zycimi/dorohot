/*
 * @Author: 白雾茫茫丶<baiwumm.com>
 * @Date: 2026-01-20 15:22:39
 * @LastEditors: 白雾茫茫丶<baiwumm.com>
 * @LastEditTime: 2026-07-03 15:03:59
 * @Description: Github - 热门仓库
 */
import * as cheerio from 'cheerio'
import { NextResponse } from 'next/server'
import { ProxyAgent } from 'undici'

import { RESPONSE } from '@/enums'
import { responseError, responseSuccess } from '@/lib/utils'

import type { HotListItem } from '@/types'

export async function GET() {
  // 官方 url
  const url = 'https://github.com'
  const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'

  // 直连优先（Pi 上可直连）；直连失败才尝试代理。
  // 代理地址从环境变量 GITHUB_PROXY 读取（如 socks://127.0.0.1:1086），
  // 不设置则始终直连。
  async function fetchTrending(dispatcher?: unknown): Promise<Response> {
    return fetch(`${url}/trending`, {
      ...(dispatcher ? { dispatcher } : {}),
      headers: { 'User-Agent': UA },
      cache: 'no-store',
    })
  }

  try {
    let response = await fetchTrending()
    const proxy = process.env.GITHUB_PROXY
    if (!response.ok && proxy) {
      // 直连失败且配置了代理 → 走代理重试
      const { ProxyAgent } = await import('undici')
      const agent = new ProxyAgent(proxy)
      try {
        response = await fetchTrending(agent)
      }
      finally {
        agent.close()
      }
    }
    if (!response.ok) {
      // 如果请求失败，抛出错误，不进行缓存
      throw new Error(`${RESPONSE.label(RESPONSE.ERROR)}：Github - 热门仓库`)
    }

    // 格式化 star 数
    function formatStars(count: number): string {
      if (count < 1000)
        return count.toString()

      if (count < 1_000_000) {
        return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}K`
      }

      return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
    }

    // 得到请求体
    const responseBody = await response.text()
    const $ = cheerio.load(responseBody)
    const listDom = $('.Box article.Box-row')
    const result: HotListItem[] = listDom.get().map((repo, index) => {
      const $repo = $(repo)
      const relativeUrl = $repo.find('.h3').find('a').attr('href')
      return {
        id: relativeUrl || String(index),
        title: (relativeUrl || '').replace(/^\//, ''),
        desc: $repo.find('p.my-1').text().trim() || '',
        tip: formatStars(parseInt(
          $repo
            .find('.tmp-mr-3 svg[aria-label=\'star\']')
            .first()
            .parent()
            .text()
            .trim()
            .replace(',', '') || '0',
          10,
        )),
        url: `${url}${relativeUrl}`,
        mobileUrl: `${url}${relativeUrl}`,
      }
    })
    return NextResponse.json(responseSuccess(result))
  }
  catch {
    return NextResponse.json(responseError)
  }
}

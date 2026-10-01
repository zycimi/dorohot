/*
 * @Description: 组装并发送「热榜订阅」邮件
 *  - 数据来源复用 lib/ai.ts 的 collectSources（各 REST 数据源）
 *  - 开启「AI 自动分析」时，额外调用 buildBriefing 生成一段分析放进邮件
 */
import { HOT_ITEMS } from '@/enums'
import { buildBriefing, collectSources } from '@/lib/ai'
import { channelLabel, formatChannelDigest, sendToChannels, subscriptionChannelIds } from '@/lib/channels'
import { sendMail } from '@/lib/mailer'
import { writeSubscription } from '@/lib/subscription'

import type { AiSourceItem } from '@/lib/ai'
import type { SubscriptionConfig } from '@/lib/subscription'

export interface SubscriptionSourceBlock {
  label: string
  alias: string
  items: AiSourceItem[]
}

export interface SubscriptionContent {
  sources: SubscriptionSourceBlock[]
  analysis: string
  usedSources: number
  usedItems: number
}

function allAliases(): string[] {
  return HOT_ITEMS.items.map(item => String(item.value))
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function formatDateTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function escapeHtml(value: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }
  return value.replace(/[&<>"']/g, c => map[c] || c)
}

/** @description: 拉取所选数据源（空 = 全部），可选生成 AI 分析 */
export async function buildSubscriptionContent(config: SubscriptionConfig): Promise<SubscriptionContent> {
  const aliases = config.sources.length ? config.sources : allAliases()
  const sources = await collectSources(aliases, { perSource: config.perSource })
  const usedSources = sources.filter(s => s.items.length).length
  const usedItems = sources.reduce((sum, s) => sum + s.items.length, 0)

  let analysis = ''
  if (config.aiAnalysis && usedItems) {
    try {
      const brief = await buildBriefing(
        sources.map(s => ({ label: s.label, items: s.items })),
        { maxTokens: 6000 },
      )
      analysis = brief.text
    }
    catch (error) {
      analysis = `（AI 自动分析生成失败：${error instanceof Error ? error.message : String(error)}）`
    }
  }

  return { sources, analysis, usedSources, usedItems }
}

function buildText(config: SubscriptionConfig, content: SubscriptionContent, ts: number, test: boolean): string {
  const lines: string[] = []
  lines.push(`${test ? '[测试] ' : ''}doroHot 热榜订阅 · ${formatDateTime(ts)}`)
  lines.push(`共 ${content.usedSources} 个源 / ${content.usedItems} 条`)
  lines.push('')
  for (const block of content.sources) {
    if (!block.items.length)
      continue
    lines.push(`【${block.label}】`)
    block.items.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.title}`)
      if (item.desc)
        lines.push(`   ${item.desc.replace(/\s+/g, ' ').slice(0, 120)}`)
      if (item.url)
        lines.push(`   ${item.url}`)
    })
    lines.push('')
  }
  if (content.analysis) {
    lines.push('—— AI 自动分析 ——', '', content.analysis, '')
  }
  lines.push('--', '由 doroHot 邮箱订阅自动发送')
  return lines.join('\n')
}

function buildHtml(config: SubscriptionConfig, content: SubscriptionContent, ts: number, test: boolean): string {
  const blocks = content.sources.filter(b => b.items.length).map((block) => {
    const items = block.items.map(item => `
      <li style="margin:0 0 10px;line-height:1.6;">
        <a href="${escapeHtml(item.url || '#')}" style="color:#2563eb;text-decoration:none;font-weight:600;">${escapeHtml(item.title)}</a>
        ${item.desc ? `<div style="color:#6b7280;font-size:12px;margin-top:2px;">${escapeHtml(item.desc.replace(/\s+/g, ' ').slice(0, 140))}</div>` : ''}
      </li>`).join('')
    return `
      <section style="margin:0 0 18px;">
        <h3 style="margin:0 0 8px;font-size:15px;color:#111827;border-left:3px solid #2563eb;padding-left:8px;">${escapeHtml(block.label)}</h3>
        <ul style="margin:0;padding-left:20px;">${items}</ul>
      </section>`
  }).join('')

  const analysis = content.analysis
    ? `<section style="margin:20px 0 0;padding:14px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;">
         <h3 style="margin:0 0 8px;font-size:15px;color:#111827;">AI 自动分析</h3>
         <pre style="margin:0;white-space:pre-wrap;word-break:break-word;font-family:inherit;font-size:13px;color:#374151;line-height:1.7;">${escapeHtml(content.analysis)}</pre>
       </section>`
    : ''

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:20px;background:#f3f4f6;">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:12px;padding:20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#111827;">
    <h2 style="margin:0 0 4px;font-size:18px;">${test ? '[测试] ' : ''}doroHot 热榜订阅</h2>
    <div style="color:#6b7280;font-size:12px;margin-bottom:16px;">${formatDateTime(ts)} · ${content.usedSources} 个源 / ${content.usedItems} 条</div>
    ${blocks || '<div style="color:#6b7280;">本次没有取到数据源内容。</div>'}
    ${analysis}
    <div style="margin-top:20px;color:#9ca3af;font-size:11px;border-top:1px solid #e5e7eb;padding-top:10px;">由 doroHot 邮箱订阅自动发送</div>
  </div>
</body></html>`
}

/** @description: 组装并发送一封订阅邮件；成功后写回 lastSentAt/lastStatus */
export async function sendSubscriptionEmail(config: SubscriptionConfig, options: { test?: boolean } = {}) {
  const content = await buildSubscriptionContent(config)
  const ts = Date.now()
  const test = !!options.test
  const subject = `${test ? '[测试] ' : ''}doroHot 热榜订阅 · ${formatDateTime(ts)}`

  await sendMail(config.smtp, {
    to: config.email,
    subject,
    text: buildText(config, content, ts, test),
    html: buildHtml(config, content, ts, test),
  })

  writeSubscription({ lastSentAt: ts, lastStatus: `成功 · ${formatDateTime(ts)} · ${content.usedItems} 条` })

  // 远程接入渠道（飞书 / 钉钉 / 企业微信）随订阅一起推送；失败不影响邮件结果
  const channelIds = subscriptionChannelIds()
  if (channelIds.length) {
    try {
      const text = formatChannelDigest(
        content.sources.map(s => ({ label: s.label, items: s.items })),
        content.analysis,
        ts,
        { test, titlesOnly: true },
      )
      await sendToChannels(text, channelIds)
    }
    catch {
      // 渠道推送失败不改变「邮件已成功」的结论
    }
  }

  return { ...content, sentAt: ts, subject }
}

/**
 * @description: 只推送到远程接入渠道（用于「未配置邮箱、只推群机器人」的定时场景）
 *  - 与邮件路径共用内容构建；成功后写回 lastSentAt / lastStatus
 */
export async function sendSubscriptionToChannels(config: SubscriptionConfig, options: { test?: boolean } = {}) {
  const content = await buildSubscriptionContent(config)
  const ts = Date.now()
  const test = !!options.test
  const ids = subscriptionChannelIds()
  if (!ids.length)
    throw new Error('没有启用「随订阅推送」的远程渠道')

  const text = formatChannelDigest(
    content.sources.map(s => ({ label: s.label, items: s.items })),
    content.analysis,
    ts,
    { test, titlesOnly: true },
  )
  const results = await sendToChannels(text, ids)
  const ok = results.filter(r => r.ok).length

  if (ok) {
    writeSubscription({ lastSentAt: ts, lastStatus: `已推送 ${ok}/${results.length} 个渠道 · ${formatDateTime(ts)} · ${content.usedItems} 条` })
  }
  else {
    const detail = results.map(r => `${channelLabel(r.id)}(${r.error ?? '失败'})`).join('；')
    writeSubscription({ lastStatus: `渠道推送失败 · ${detail.slice(0, 180)}` })
  }

  return { ...content, sentAt: ts, results }
}

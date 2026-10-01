/*
 * @Description: 把一句自然语言解析成邮箱订阅配置 patch（POST /api/ai/subscription/parse）
 *  body: { text: string }
 *
 * 只解析「可编辑配置」：enabled / email / interval / unit / sources / perSource / aiAnalysis。
 * **绝不涉及 SMTP 与密码**（模型看不到、也不返回），密码只在设置表单里手填。
 * 服务端再用 normalizeSubscription 钳制一次；前端拿到后必须由用户确认才会保存。
 */
import { NextResponse } from 'next/server'

import { HOT_ITEMS } from '@/enums'
import { chatConversation, sourceLabel } from '@/lib/ai'
import { intervalMinutes, normalizeSubscription, readSubscription } from '@/lib/subscription'

import type { SubscriptionConfig } from '@/lib/subscription'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const UNIT_LABEL: Record<string, string> = { minute: '分钟', hour: '小时', day: '天（24 小时）' }

const SYSTEM = [
  '你是 doroHot「邮箱订阅」的配置解析器：把用户随口说的一句话解析成一个 JSON 对象。',
  '只输出一个 JSON 对象。不要解释、不要 Markdown 代码围栏、不要多余文字。',
  '可用字段（只输出用户明确要改的字段，未提到的不要输出）：',
  '  enabled: boolean，是否开启订阅（表达「发给我 / 推送 / 订阅」通常为 true；「停止 / 取消 / 别发了」为 false）',
  '  email: string，收件邮箱',
  '  interval: number，发送间隔数量（1–10080）',
  '  unit: "minute" | "hour" | "day"',
  '  sources: string[]，只填给定的 alias（用户说「全部/都要」就输出空数组 []）',
  '  perSource: number，每个数据源取几条（1–20）',
  '  aiAnalysis: boolean，邮件是否附带 AI 自动分析',
  '  windowEnabled: boolean，是否只在每天的固定时间窗口内发送',
  '  dailyAtEnabled: boolean，是否「每天定点 HH:MM 只发一次」',
  '  dailyAt: "HH:MM"（24 小时制，如 "09:00"）',
  '  weeklyEnabled: boolean，是否「每周指定星期几定点发送」',
  '  weekDays: number[]，每周几，0=周日、1=周一 … 6=周六（去重升序）',
  '  weeklyAt: "HH:MM"（每周定点的时刻）',
  '  monthlyEnabled: boolean，是否「每月指定几号定点发送」',
  '  monthDays: number[]，每月几号，取值 1-31（去重升序）',
  '  monthlyAt: "HH:MM"（每月定点的时刻）',
  '  windowStart: "HH:MM"（24 小时制，如 "09:00"）',
  '  windowEnd: "HH:MM"（24 小时制，如 "18:00"）',
  '定点规则：「每天早上9点发一次」→ dailyAtEnabled=true, dailyAt="09:00"；',
  '「每周一三五早上9点发」→ weeklyEnabled=true, weekDays=[1,3,5], weeklyAt="09:00", monthlyEnabled=false, dailyAtEnabled=false；',
  '「每月1号和15号早上8点发」→ monthlyEnabled=true, monthDays=[1,15], monthlyAt="08:00", weeklyEnabled=false, dailyAtEnabled=false；',
  '三种日历（monthly/weekly/dailyAt）互斥：命中其中一种就把另外两个置 false；日历模式（weekly/monthly）不要输出 windowEnabled 与 interval。',
  '「每隔60分钟 / 每2小时」→ dailyAtEnabled=false（走 interval+unit）；「每天早上9点到下午6点每隔60分钟」是时间窗口+间隔，不要当定点。',
  '时间窗口规则：「早上9点到下午6点」→ windowEnabled=true, windowStart="09:00", windowEnd="18:00"；',
  '「每隔60分钟」→ interval=60, unit="minute"；「全天 / 不限时间」→ windowEnabled=false。',
  '严禁输出 smtp / host / port / user / pass / password / from 等任何 SMTP 字段。',
].join('\n')

function currentSummary(config: SubscriptionConfig): string {
  return JSON.stringify({
    enabled: config.enabled,
    email: config.email || '(未设置)',
    interval: config.interval,
    unit: config.unit,
    sources: config.sources.length ? config.sources : '(全部)',
    perSource: config.perSource,
    aiAnalysis: config.aiAnalysis,
    schedule: config.monthlyEnabled && config.monthDays.length
      ? `每月 ${config.monthDays.join('、')} 号 ${config.monthlyAt}`
      : config.weeklyEnabled && config.weekDays.length
        ? `每周${config.weekDays.map(d => WEEKDAY_LABEL[d]).join('、')} ${config.weeklyAt}`
        : config.dailyAtEnabled ? `每天 ${config.dailyAt}` : `每 ${config.interval} ${config.unit}`,
    weekly: config.weeklyEnabled ? `每周${config.weekDays.map(d => WEEKDAY_LABEL[d]).join('、')} ${config.weeklyAt}` : '(未启用)',
    monthly: config.monthlyEnabled ? `每月 ${config.monthDays.join('、')} 号 ${config.monthlyAt}` : '(未启用)',
    window: config.windowEnabled ? `${config.windowStart}-${config.windowEnd}` : '(全天)',
  })
}

const WEEKDAY_LABEL = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * @description: 从中文句子里兜底抽「9点至18点 / 09:00-18:00」这类时间窗口
 * 仅在模型没给出合法起止时使用；支持「早上9点至下午18点」「下午2点到6点」。
 */
function windowFromText(text: string): { start: string, end: string } | null {
  const re = /(?:(上午|下午|晚上|早上|凌晨)\s*)?(\d{1,2})(?:\s*[:：]\s*(\d{2}))?\s*(?:点|时)?\s*(?:至|到|~|-|—)\s*(?:(上午|下午|晚上|早上|凌晨)\s*)?(\d{1,2})(?:\s*[:：]\s*(\d{2}))?\s*(?:点|时)?/
  const m = text.match(re)
  if (!m)
    return null
  const periodToHour = (period: string | undefined, hour: number) => {
    if ((period === '下午' || period === '晚上') && hour < 12)
      return hour + 12
    if ((period === '上午' || period === '早上' || period === '凌晨') && hour === 12)
      return 0
    return hour
  }
  const startHour = periodToHour(m[1], Number(m[2]))
  const endHour0 = periodToHour(m[4], Number(m[5]))
  // 「下午2点到6点」这种第二个时段省略、且结束比开始小的，按同一半天顺延
  const endHour = (!m[4] && (m[1] === '下午' || m[1] === '晚上') && endHour0 < 12 && endHour0 <= startHour)
    ? endHour0 + 12
    : endHour0
  const startMin = m[3] ? Number(m[3]) : 0
  const endMin = m[6] ? Number(m[6]) : 0
  if (startHour > 23 || endHour > 23 || startMin > 59 || endMin > 59)
    return null
  const pad = (n: number) => String(n).padStart(2, '0')
  return { start: `${pad(startHour)}:${pad(startMin)}`, end: `${pad(endHour)}:${pad(endMin)}` }
}

/** @description: 中文星期 token → 0-6（0=周日）；无法识别返回 null */
function weekdayFromToken(ch: string): number | null {
  if (/^\d$/.test(ch)) {
    const n = Number(ch)
    if (n >= 1 && n <= 6)
      return n
    return n === 7 ? 0 : null
  }
  const map: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 }
  return map[ch] ?? null
}

/** @description: 从片段里取第一个合法星期 token */
function firstWeekday(part: string): number | null {
  for (const ch of part) {
    const day = weekdayFromToken(ch)
    if (day !== null)
      return day
  }
  return null
}

/**
 * @description: 从句子里兜底解析「每周几」
 *  - 「工作日」→ 周一~周五；「周末 / 双休」→ 周六日
 *  - 「每周一三五 / 周一、周三 / 周一到周五」→ 提取片段里的星期 token（区间展开为闭区间）
 *  - 句中必须出现「周 / 星期 / 礼拜」且至少解析出一个合法星期，否则返回 null
 */
function weeklyFromText(text: string): { days: number[] } | null {
  if (/工作日/.test(text))
    return { days: [1, 2, 3, 4, 5] }
  if (/周末|双休/.test(text))
    return { days: [0, 6] }
  const m = text.match(/每?(?:周|星期|礼拜)([一二三四五六日天0-9、,，和及到至~\-周星期礼拜]+)/)
  if (!m)
    return null
  const seg = m[1]
  if (/到|至|~|-/.test(seg)) {
    const [left, right] = seg.split(/到|至|~|-/)
    const a = firstWeekday(left || '')
    const b = firstWeekday(right || '')
    if (a === null || b === null)
      return null
    if (a <= b)
      return { days: Array.from({ length: b - a + 1 }, (_, i) => a + i) }
    return { days: [...new Set([a, b])].sort((x, y) => x - y) }
  }
  const days = new Set<number>()
  for (const ch of seg) {
    const day = weekdayFromToken(ch)
    if (day !== null)
      days.add(day)
  }
  if (!days.size)
    return null
  return { days: [...days].sort((a, b) => a - b) }
}

/** @description: 从句子里兜底解析「每月几号」（仅当句中有「每月」时；用「号 / 日」规避时间「9点」） */
function monthlyFromText(text: string): { days: number[] } | null {
  if (!/每\s*(?:个)?月/.test(text))
    return null
  const days = new Set<number>()
  for (const m of text.matchAll(/(\d{1,2})\s*[号日]/g)) {
    const n = Number(m[1])
    if (n >= 1 && n <= 31)
      days.add(n)
  }
  if (!days.size)
    return null
  return { days: [...days].sort((a, b) => a - b) }
}

/** @description: 从句子里抽一个时刻（HH:MM）；支持「早上9点 / 下午2点 / 晚上8点30分」这类写法 */
function timeFromText(text: string): string | null {
  const m = text.match(/(?:(上午|下午|晚上|早上|凌晨)\s*)?(\d{1,2})(?:\s*[:：]\s*(\d{2}))?\s*(?:点|时)/)
  if (!m)
    return null
  let hour = Number(m[2])
  if ((m[1] === '下午' || m[1] === '晚上') && hour < 12)
    hour += 12
  if ((m[1] === '上午' || m[1] === '早上' || m[1] === '凌晨') && hour === 12)
    hour = 0
  const minute = m[3] ? Number(m[3]) : 0
  if (hour > 23 || minute > 59)
    return null
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(hour)}:${pad(minute)}`
}

/** @description: 兜底抽「每天/每日 早上9点」这类定点时刻（仅在模型没给定时用） */
function dailyAtFromText(text: string): string | null {
  if (!/(每天|每日|每晚)/.test(text))
    return null
  return timeFromText(text)
}

/** @description: 过滤模型给出的「周几 / 几号」数组：仅保留 [min,max] 内的整数，去重升序（无合法项返回 undefined） */
function dayArray(value: unknown, min: number, max: number): number[] | undefined {
  if (!Array.isArray(value))
    return undefined
  const out = new Set<number>()
  for (const item of value) {
    const n = Number(item)
    if (Number.isInteger(n) && n >= min && n <= max)
      out.add(n)
  }
  return out.size ? [...out].sort((a, b) => a - b) : undefined
}

/** @description: 从模型输出里抠出第一个 JSON 对象（容忍 ```json 围栏与前后解释文字） */
function parseJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start)
    return null
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  }
  catch {
    return null
  }
}

/** @description: 生成人话版「将修改」列表（只列相对当前配置的变化；发送方式按 monthly > weekly > dailyAt > interval 归一展示） */
function diffSummary(next: SubscriptionConfig, base: SubscriptionConfig): string[] {
  const out: string[] = []
  const modeOf = (c: SubscriptionConfig) =>
    c.monthlyEnabled && c.monthDays.length
      ? 'monthly'
      : c.weeklyEnabled && c.weekDays.length ? 'weekly' : c.dailyAtEnabled ? 'daily' : 'interval'
  const nextMode = modeOf(next)
  const baseMode = modeOf(base)
  const modeChanged = nextMode !== baseMode
  if (next.enabled !== base.enabled)
    out.push(next.enabled ? '开启订阅' : '暂停订阅')
  if (next.email !== base.email)
    out.push(`收件邮箱：${next.email || '（清空）'}`)
  const weeklyText = `每${next.weekDays.map(d => WEEKDAY_LABEL[d]).join('、')} ${next.weeklyAt} 定点发送`
  const monthlyText = `每月 ${next.monthDays.join('、')} 号 ${next.monthlyAt} 定点发送`
  if (nextMode === 'monthly') {
    if (modeChanged || next.monthDays.join(',') !== base.monthDays.join(',') || next.monthlyAt !== base.monthlyAt)
      out.push(monthlyText)
  }
  else if (nextMode === 'weekly') {
    if (modeChanged || next.weekDays.join(',') !== base.weekDays.join(',') || next.weeklyAt !== base.weeklyAt)
      out.push(weeklyText)
  }
  else if (nextMode === 'daily') {
    if (modeChanged || next.dailyAt !== base.dailyAt)
      out.push(`发送方式：每天 ${next.dailyAt} 定点发送`)
  }
  else if (modeChanged) {
    out.push('发送方式：按固定间隔')
  }
  if (nextMode === 'interval' && (next.interval !== base.interval || next.unit !== base.unit))
    out.push(`发送频率：每 ${next.interval} ${UNIT_LABEL[next.unit] || next.unit}`)
  if (next.perSource !== base.perSource)
    out.push(`每个源条数：${next.perSource}`)
  if (next.aiAnalysis !== base.aiAnalysis)
    out.push(`邮件附带 AI 分析：${next.aiAnalysis ? '开' : '关'}`)
  if (nextMode === 'interval' && (next.windowEnabled !== base.windowEnabled || (next.windowEnabled && (next.windowStart !== base.windowStart || next.windowEnd !== base.windowEnd))))
    out.push(next.windowEnabled ? `时间窗口：${next.windowStart}–${next.windowEnd}` : '时间窗口：关闭')
  const a = [...next.sources].sort().join(',')
  const b = [...base.sources].sort().join(',')
  if (a !== b)
    out.push(`数据源：${next.sources.length ? next.sources.map(sourceLabel).join('、') : '全部'}`)
  return out
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const text = typeof body?.text === 'string' ? body.text.trim().slice(0, 500) : ''
    if (!text) {
      return NextResponse.json(
        { code: 400, msg: '请先描述你的订阅需求', data: null, timestamp: Date.now() },
        { status: 400 },
      )
    }

    const base = readSubscription()
    const aliases = HOT_ITEMS.items.map(item => ({ alias: String(item.value), name: item.raw.label }))
    const validAliases = new Set(aliases.map(a => a.alias))

    const userContent = [
      `当前配置：${currentSummary(base)}`,
      `可选数据源（alias=中文名）：${aliases.map(a => `${a.alias}=${a.name}`).join('，')}`,
      `用户需求：${text}`,
      '只输出 JSON 对象。',
    ].join('\n')

    const result = await chatConversation(
      [{ role: 'user', content: userContent }],
      { system: SYSTEM, temperature: 0.2, maxTokens: 600, timeoutMs: 60_000 },
    )

    const obj = parseJsonObject(result.text)
    if (!obj)
      throw new Error('模型没有返回可解析的 JSON，请换个说法，或直接用下方表单设置')

    const raw: Record<string, unknown> = {}
    if (obj.enabled !== undefined)
      raw.enabled = !!obj.enabled
    if (typeof obj.email === 'string')
      raw.email = obj.email
    if (obj.interval !== undefined)
      raw.interval = Number(obj.interval)
    if (obj.unit !== undefined)
      raw.unit = obj.unit
    if (Array.isArray(obj.sources))
      raw.sources = obj.sources.filter((s): s is string => typeof s === 'string' && validAliases.has(s))
    if (obj.perSource !== undefined)
      raw.perSource = Number(obj.perSource)
    if (obj.aiAnalysis !== undefined)
      raw.aiAnalysis = !!obj.aiAnalysis
    if (obj.dailyAtEnabled !== undefined)
      raw.dailyAtEnabled = !!obj.dailyAtEnabled
    if (typeof obj.dailyAt === 'string' && TIME_RE.test(obj.dailyAt.trim()))
      raw.dailyAt = obj.dailyAt.trim()
    if (obj.weeklyEnabled !== undefined)
      raw.weeklyEnabled = !!obj.weeklyEnabled
    const weekDays = dayArray(obj.weekDays, 0, 6)
    if (weekDays)
      raw.weekDays = weekDays
    if (typeof obj.weeklyAt === 'string' && TIME_RE.test(obj.weeklyAt.trim()))
      raw.weeklyAt = obj.weeklyAt.trim()
    if (obj.monthlyEnabled !== undefined)
      raw.monthlyEnabled = !!obj.monthlyEnabled
    const monthDays = dayArray(obj.monthDays, 1, 31)
    if (monthDays)
      raw.monthDays = monthDays
    if (typeof obj.monthlyAt === 'string' && TIME_RE.test(obj.monthlyAt.trim()))
      raw.monthlyAt = obj.monthlyAt.trim()
    if (obj.windowEnabled !== undefined)
      raw.windowEnabled = !!obj.windowEnabled
    if (typeof obj.windowStart === 'string' && TIME_RE.test(obj.windowStart.trim()))
      raw.windowStart = obj.windowStart.trim()
    if (typeof obj.windowEnd === 'string' && TIME_RE.test(obj.windowEnd.trim()))
      raw.windowEnd = obj.windowEnd.trim()

    // 兜底：模型没给合法起止，但句子里写了「9点至18点」
    if (raw.windowStart === undefined || raw.windowEnd === undefined) {
      const win = windowFromText(text)
      if (win) {
        raw.windowStart = win.start
        raw.windowEnd = win.end
      }
    }
    if ((raw.windowStart !== undefined || raw.windowEnd !== undefined) && raw.windowEnabled === undefined)
      raw.windowEnabled = true

    // 兜底：模型没给「日历定点」，但句子里写了「每周一三五早上9点」「每月1号和15号早上8点」（不是窗口）
    const hasInterval = /每隔|每\s*\d+\s*(分钟|小时|天)/.test(text)
    const hasRange = !!windowFromText(text)
    const hasCalendarFromModel = raw.weeklyEnabled !== undefined || raw.monthlyEnabled !== undefined
      || raw.dailyAtEnabled !== undefined || raw.dailyAt !== undefined
    if (!hasCalendarFromModel && !hasRange) {
      // 同时命中时「每月」优先（与调度优先级 monthly > weekly > dailyAt 一致）
      const monthly = monthlyFromText(text)
      const weekly = monthly ? null : weeklyFromText(text)
      if (monthly) {
        raw.monthlyEnabled = true
        raw.monthDays = monthly.days
        raw.monthlyAt = timeFromText(text) ?? '09:00'
        raw.weeklyEnabled = false
        raw.dailyAtEnabled = false
      }
      else if (weekly) {
        raw.weeklyEnabled = true
        raw.weekDays = weekly.days
        raw.weeklyAt = timeFromText(text) ?? '09:00'
        raw.monthlyEnabled = false
        raw.dailyAtEnabled = false
      }
      else if (!hasInterval) {
        const at = dailyAtFromText(text)
        if (at) {
          raw.dailyAt = at
          raw.dailyAtEnabled = true
        }
      }
    }

    // 服务端互斥收敛：三种日历（monthly > weekly > dailyAt）只保留一个
    if (raw.monthlyEnabled === true) {
      raw.weeklyEnabled = false
      raw.dailyAtEnabled = false
    }
    else if (raw.weeklyEnabled === true) {
      raw.dailyAtEnabled = false
    }

    // 兜底：模型没抽到邮箱时，用正则从原句里补一个（很常见，值得兜）
    if (raw.email === undefined) {
      const email = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)
      if (email)
        raw.email = email[0]
    }

    const next = normalizeSubscription(raw, base)
    const summary = diffSummary(next, base)

    return NextResponse.json({
      code: 200,
      msg: '解析成功',
      data: {
        // 只回可编辑字段；smtp/密码永不涉及
        patch: {
          enabled: next.enabled,
          email: next.email,
          interval: next.interval,
          unit: next.unit,
          sources: next.sources,
          perSource: next.perSource,
          aiAnalysis: next.aiAnalysis,
          dailyAtEnabled: next.dailyAtEnabled,
          dailyAt: next.dailyAt,
          weeklyEnabled: next.weeklyEnabled,
          weekDays: next.weekDays,
          weeklyAt: next.weeklyAt,
          monthlyEnabled: next.monthlyEnabled,
          monthDays: next.monthDays,
          monthlyAt: next.monthlyAt,
          windowEnabled: next.windowEnabled,
          windowStart: next.windowStart,
          windowEnd: next.windowEnd,
        },
        summary,
        intervalMinutes: intervalMinutes(next.interval, next.unit),
      },
      timestamp: Date.now(),
    })
  }
  catch (error) {
    return NextResponse.json(
      { code: 500, msg: error instanceof Error ? error.message : '解析失败', data: null, timestamp: Date.now() },
      { status: 500 },
    )
  }
}

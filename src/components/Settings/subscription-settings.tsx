/*
 * @Description: 邮件订阅设置（/settings 的「邮件订阅」分区；AI 助手抽屉已不再内嵌本组件）
 *
 *  - 三块式：**开启邮箱订阅**（总览条 + 独立开关）→ **AI 配置（一句话设置）**
 *    （内嵌「发到哪个邮箱 / 多久发一次 / 发哪些内容」）→ **SMTP 服务器设置**
 *  - 订阅规则：按间隔（分钟/小时/天，day=1440 分钟）/ 每天定点 / 每周几 / 每月几号，四选一
 *  - 可选数据源（不选 = 全部）、每源条数、是否附带 AI 自动分析
 *  - SMTP 配置（host/port/SSL/用户名/密码/发件人）；密码只回掩码，留空表示不修改
 *  - 保存后由服务端调度器按规则发送；也可手动「发送测试邮件」（先保存再发）
 */
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { useAiAssistantStore } from '@/components/AiAssistant/store'

import { post } from '@/lib/ai-client'

import type { Notify } from '@/lib/ai-client'

type Unit = 'minute' | 'hour' | 'day'

interface PublicSmtp {
  host: string
  port: number
  secure: boolean
  user: string
  pass: string
  hasPass: boolean
  from: string
}

interface PublicSubscription {
  enabled: boolean
  email: string
  interval: number
  unit: Unit
  sources: string[]
  perSource: number
  aiAnalysis: boolean
  dailyAtEnabled: boolean
  dailyAt: string
  weeklyEnabled: boolean
  weekDays: number[]
  weeklyAt: string
  monthlyEnabled: boolean
  monthDays: number[]
  monthlyAt: string
  windowEnabled: boolean
  windowStart: string
  windowEnd: string
  smtp: PublicSmtp
  lastSentAt: number
  lastStatus: string
  intervalMinutes: number
  nextSendAt: number
  configured: boolean
  file: string
}

interface FormState {
  enabled: boolean
  email: string
  interval: number
  unit: Unit
  sources: string[]
  perSource: number
  aiAnalysis: boolean
  dailyAtEnabled: boolean
  dailyAt: string
  weeklyEnabled: boolean
  weekDays: number[]
  weeklyAt: string
  monthlyEnabled: boolean
  monthDays: number[]
  monthlyAt: string
  windowEnabled: boolean
  windowStart: string
  windowEnd: string
  host: string
  port: number
  secure: boolean
  user: string
  pass: string
  from: string
}

const UNIT_LABEL: Record<Unit, string> = { minute: '分钟', hour: '小时', day: '天（24 小时）' }
const WEEKDAY_LABEL = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function toForm(config: PublicSubscription): FormState {
  return {
    enabled: config.enabled,
    email: config.email,
    interval: config.interval,
    unit: config.unit,
    sources: config.sources,
    perSource: config.perSource,
    aiAnalysis: config.aiAnalysis,
    dailyAtEnabled: config.dailyAtEnabled,
    dailyAt: config.dailyAt,
    weeklyEnabled: config.weeklyEnabled,
    weekDays: config.weekDays,
    weeklyAt: config.weeklyAt,
    monthlyEnabled: config.monthlyEnabled,
    monthDays: config.monthDays,
    monthlyAt: config.monthlyAt,
    windowEnabled: config.windowEnabled,
    windowStart: config.windowStart,
    windowEnd: config.windowEnd,
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    user: config.smtp.user,
    pass: '',
    from: config.smtp.from,
  }
}

function formatTime(ts: number): string {
  if (!ts)
    return '未排期'
  return new Date(ts).toLocaleString('zh-CN', { hour12: false })
}

export function SubscriptionSettings({ notify }: { notify: Notify }) {
  const [config, setConfig] = useState<PublicSubscription | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [aiText, setAiText] = useState('')
  const [aiParsing, setAiParsing] = useState(false)
  const [aiPreview, setAiPreview] = useState<{ patch: Partial<FormState>, summary: string[], intervalMinutes: number } | null>(null)
  const aiRef = useRef<HTMLTextAreaElement>(null)
  const hostRef = useRef<HTMLInputElement>(null)
  const smtpRef = useRef<HTMLDetailsElement>(null)
  // AI对话里用 `/订阅 …` 保存成功后 tick +1：这里跟着重新拉一次，避免面板显示旧配置
  const subscriptionTick = useAiAssistantStore(s => s.historyTick.subscription)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/subscription', { cache: 'no-store' })
      const json = await response.json().catch(() => null)
      if (!response.ok || !json || json.code !== 200)
        throw new Error(json?.msg || `读取失败（HTTP ${response.status}）`)
      setConfig(json.data)
      setForm(toForm(json.data))
    }
    catch (error) {
      notify(error instanceof Error ? error.message : '读取订阅配置失败', false)
    }
    finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => { if (subscriptionTick) void load() }, [subscriptionTick, load])

  const patch = (next: Partial<FormState>) => setForm(prev => (prev ? { ...prev, ...next } : prev))

  const save = async (override?: Partial<FormState>) => {
    if (!form)
      return null
    const base = override ? { ...form, ...override } : form
    setSaving(true)
    try {
      const data = await post<PublicSubscription>('/api/subscription', {
        enabled: base.enabled,
        email: base.email,
        interval: base.interval,
        unit: base.unit,
        sources: base.sources,
        perSource: base.perSource,
        aiAnalysis: base.aiAnalysis,
        dailyAtEnabled: base.dailyAtEnabled,
        dailyAt: base.dailyAt,
        weeklyEnabled: base.weeklyEnabled,
        weekDays: base.weekDays,
        weeklyAt: base.weeklyAt,
        monthlyEnabled: base.monthlyEnabled,
        monthDays: base.monthDays,
        monthlyAt: base.monthlyAt,
        windowEnabled: base.windowEnabled,
        windowStart: base.windowStart,
        windowEnd: base.windowEnd,
        smtp: {
          host: base.host,
          port: base.port,
          secure: base.secure,
          user: base.user,
          pass: base.pass,
          from: base.from,
        },
      })
      setConfig(data)
      setForm(toForm(data))
      return data
    }
    catch (error) {
      notify(error instanceof Error ? error.message : '保存失败', false)
      return null
    }
    finally {
      setSaving(false)
    }
  }

  const onSave = async () => {
    const saved = await save()
    if (saved)
      notify('订阅设置已保存')
  }

  const onTest = async () => {
    const saved = await save()
    if (!saved)
      return
    if (!saved.email || !saved.smtp.host) {
      notify('请先填写收件邮箱与 SMTP 服务器', false)
      return
    }
    setTesting(true)
    try {
      const result = await post<{ usedItems: number }>('/api/subscription/test', {})
      notify(`测试邮件已发送（${result?.usedItems ?? 0} 条），请查收`)
      await load()
    }
    catch (error) {
      notify(error instanceof Error ? error.message : '发送失败', false)
    }
    finally {
      setTesting(false)
    }
  }

  const parseAi = async () => {
    const text = aiText.trim()
    if (!text) {
      notify('先写一句话，例如「每 2 小时把微博热榜发到 me@qq.com」', false)
      return
    }
    setAiParsing(true)
    try {
      const data = await post<{ patch: Partial<FormState>, summary: string[], intervalMinutes: number }>('/api/ai/subscription/parse', { text })
      setAiPreview({ patch: data.patch, summary: data.summary || [], intervalMinutes: data.intervalMinutes })
      if (!data.summary?.length)
        notify('没有识别到需要修改的项，换个说法试试', false)
    }
    catch (error) {
      notify(error instanceof Error ? error.message : '解析失败', false)
    }
    finally {
      setAiParsing(false)
    }
  }

  const applyAi = async () => {
    if (!aiPreview)
      return
    const saved = await save(aiPreview.patch)
    if (saved) {
      notify('已按 AI 解析结果保存')
      setAiPreview(null)
      setAiText('')
    }
  }

  if (loading && !form) {
    return (
      <div className="ai-card">
        <h2>邮件订阅</h2>
        <div className="ai-empty">读取中…</div>
      </div>
    )
  }

  if (!form) {
    return (
      <div className="ai-card">
        <h2>邮件订阅</h2>
        <div className="ai-warn">读取订阅配置失败，请刷新重试。</div>
      </div>
    )
  }

  const isAllSources = form.sources.length === 0
  /** 把一份配置说成「多久发一次」整句；优先级 monthly > weekly > dailyAt，与 nextSendAt 保持一致 */
  const ruleOf = (c: FormState, minutes?: number) => {
    if (c.monthlyEnabled && c.monthDays.length)
      return `每月 ${c.monthDays.join('、')} 号 ${c.monthlyAt} 定点发送（忽略间隔与时间窗口）`
    if (c.weeklyEnabled && c.weekDays.length)
      return `每${c.weekDays.map(d => WEEKDAY_LABEL[d]).join('、')} ${c.weeklyAt} 定点发送（忽略间隔与时间窗口）`
    if (c.dailyAtEnabled)
      return `每天 ${c.dailyAt} 定点发送（忽略间隔与时间窗口）`
    const per = minutes ? `（= ${minutes} 分钟）` : ''
    return `每 ${c.interval} ${UNIT_LABEL[c.unit]}发送一次${per}${c.windowEnabled ? `，仅 ${c.windowStart}–${c.windowEnd} 内` : ''}`
  }
  // AI 解析后先把 patch 并进表单，三项「解析结果」显示的是这份合并值（= 点「应用并保存」后会写入的内容）
  const aiMerged: FormState | null = aiPreview ? { ...form, ...aiPreview.patch } : null
  const display: FormState = aiMerged ?? form
  const displayRule = ruleOf(display, aiPreview?.intervalMinutes)
  const displayAllSources = display.sources.length === 0
  // 顶部总览用的「当前规则」整句（已保存/未保存都按表单当前值展示）
  const heroRule = ruleOf(form)
  // 表单是否与已保存配置有差异：驱动「有未保存的修改」与下次发送的占位文案
  const savedForm = config ? toForm(config) : null
  const dirty = !!savedForm && (
    form.enabled !== savedForm.enabled
    || form.email !== savedForm.email
    || form.interval !== savedForm.interval
    || form.unit !== savedForm.unit
    || form.sources.join(',') !== savedForm.sources.join(',')
    || form.perSource !== savedForm.perSource
    || form.aiAnalysis !== savedForm.aiAnalysis
    || form.dailyAtEnabled !== savedForm.dailyAtEnabled
    || form.dailyAt !== savedForm.dailyAt
    || form.weeklyEnabled !== savedForm.weeklyEnabled
    || form.weekDays.join(',') !== savedForm.weekDays.join(',')
    || form.weeklyAt !== savedForm.weeklyAt
    || form.monthlyEnabled !== savedForm.monthlyEnabled
    || form.monthDays.join(',') !== savedForm.monthDays.join(',')
    || form.monthlyAt !== savedForm.monthlyAt
    || form.windowEnabled !== savedForm.windowEnabled
    || form.windowStart !== savedForm.windowStart
    || form.windowEnd !== savedForm.windowEnd
    || form.host !== savedForm.host
    || form.port !== savedForm.port
    || form.secure !== savedForm.secure
    || form.user !== savedForm.user
    || form.from !== savedForm.from
    || !!form.pass
  )
  // 「保存后规则」：预览时用合并值，否则用当前表单值
  const aiRule = displayRule

  return (
    <div className="ai-card ai-sub-card">
      <div className="ai-sub-head">
        <h2>邮件订阅</h2>
        <span className={`ai-sub-state ${form.enabled ? 'on' : ''}`}>{form.enabled ? '已开启' : '已关闭'}</span>
      </div>

      {/* 总览：一眼看清「发到哪、多久发一次、下次什么时候、能不能发」 */}
      <div className={`ai-sub-hero ${form.enabled ? 'on' : ''}`}>
        <div className="ai-sub-hero-main">
          <div className="ai-sub-hero-line">{heroRule}</div>
          <div className="ai-sub-hero-sub">
            发往 <b>{form.email || '（还没填邮箱）'}</b> · {isAllSources ? '全部数据源' : `已选 ${form.sources.length} 个源`} · 每源 {form.perSource} 条{form.aiAnalysis ? ' · 附 AI 分析' : ''}
          </div>
          <div className="ai-sub-hero-sub">
            下次发送：{dirty
              ? '保存后重算'
              : (config?.enabled ? formatTime(config.nextSendAt) : '未开启')}
            <span className="ai-sub-dot">·</span>最近结果：{config?.lastStatus || '—'}
          </div>
        </div>
        <label className="ai-switch">
          <input type="checkbox" checked={form.enabled} onChange={e => patch({ enabled: e.target.checked })} />
          <span>开启邮箱订阅</span>
        </label>
      </div>

      {form.enabled && (!form.email || !form.host) && (
        <div className="ai-warn ai-sub-todo">
          还不能发信，先补齐：
          {!form.email && (
            <button type="button" className="ai-btn ghost mini" onClick={() => aiRef.current?.focus()}>
              ① 收件邮箱（用上面一句话设置）
            </button>
          )}
          {!form.host && (
            <button
              type="button"
              className="ai-btn ghost mini"
              onClick={() => {
                if (smtpRef.current)
                  smtpRef.current.open = true
                hostRef.current?.focus()
              }}
            >
              ② SMTP 服务器
            </button>
          )}
        </div>
      )}

      <section className="ai-sub-sec">
        <div className="ai-sub-sec-head">
          <span className="ai-sub-step wide">AI</span>
          AI 配置（一句话设置邮件订阅）
          {!form.email && <span className="ai-sub-sec-note need">缺收件邮箱</span>}
        </div>

        <div className="ai-nl-body">
          <div className="ai-srcinfo" style={{ marginTop: 4 }}>
            用一句话描述，AI 先解析成配置、确认后才会保存。例：「每天早上9点把热榜发到 me@qq.com」「每周一三五早上9点，只发微博和知乎，每源8条」。
            SMTP 密码请在下方「SMTP 服务器设置」里手填，不会经过 AI。也可以在「AI对话」里发 <code>/订阅 …</code>。
          </div>
          <textarea
            ref={aiRef}
            className="ai-nl-input"
            rows={2}
            value={aiText}
            onChange={e => setAiText(e.target.value)}
            placeholder="每天早上9点把热榜发到 me@qq.com"
          />
          <div className="ai-opts">
            <button type="button" className="ai-btn primary" onClick={parseAi} disabled={aiParsing || saving}>
              {aiParsing ? '解析中…' : '解析'}
            </button>
            {aiText && (
              <button type="button" className="ai-btn ghost" onClick={() => setAiText('')} disabled={aiParsing}>
                清空
              </button>
            )}
          </div>

          {aiPreview && (
            <div className="ai-nl-confirm">
              <div className="ai-nl-confirm-title">将应用以下修改：</div>
              {aiPreview.summary.length
                ? <ul className="ai-nl-list">{aiPreview.summary.map((line, index) => <li key={index}>{line}</li>)}</ul>
                : <div className="ai-srcinfo">没有识别到变化。</div>}
              <div className="ai-srcinfo" style={{ marginTop: 6 }}>
                保存后规则：{aiRule}
              </div>
              {!aiPreview.patch.email && <div className="ai-warn">还没有收件邮箱，需要补上才会发信。</div>}
              {!form.host && <div className="ai-warn">还没填 SMTP 服务器，保存后需在下方「SMTP 服务器设置」里补上才会真正发信。</div>}
              <div className="ai-opts">
                <button type="button" className="ai-btn primary" onClick={applyAi} disabled={saving || aiParsing}>
                  {saving ? '保存中…' : '应用并保存'}
                </button>
                <button type="button" className="ai-btn" onClick={() => setAiPreview(null)} disabled={saving}>
                  取消
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="ai-sub-sub">
          <div className="ai-sub-sub-head">
            发到哪个邮箱
            {!display.email && <span className="ai-sub-sec-note need">缺邮箱</span>}
          </div>
          <div className="ai-sub-value">{display.email || '（还没设置，用上面一句话设置）'}</div>
        </div>

        <div className="ai-sub-sub">
          <div className="ai-sub-sub-head">
            多久发一次
          </div>
          <div className="ai-sub-value">{displayRule}</div>
        </div>

        <div className="ai-sub-sub">
          <div className="ai-sub-sub-head">
            发哪些内容
          </div>
          <div className="ai-sub-value">
            {displayAllSources ? '全部数据源' : `已选 ${display.sources.length} 个源`} · 每源 {display.perSource} 条{display.aiAnalysis ? ' · 附 AI 分析' : ''}
          </div>
        </div>
      </section>

      <section className="ai-sub-sec">
        <div className="ai-sub-sec-head">
          <span className="ai-sub-step wide">SMTP</span>
          SMTP 服务器设置
          <span className={`ai-sub-sec-note ${config?.configured ? '' : 'need'}`}>
            {config?.configured ? '已配置' : '必填'}
          </span>
        </div>
      <details className="ai-sub-smtp" ref={smtpRef} open={!config?.configured}>
        <summary>SMTP 服务器设置</summary>
        <div className="ai-grid" style={{ marginTop: 10 }}>
          <label className="ai-field">
            SMTP 服务器
            <input ref={hostRef} value={form.host} onChange={e => patch({ host: e.target.value })} placeholder="smtp.example.com" />
          </label>
          <label className="ai-field">
            端口
            <input type="number" min={1} max={65535} value={form.port} onChange={e => patch({ port: Math.floor(Number(e.target.value) || 465) })} />
          </label>
          <label className="ai-check">
            <input type="checkbox" checked={form.secure} onChange={e => patch({ secure: e.target.checked })} />
            使用 SSL（一般 465；587/25 请取消）
          </label>
          <label className="ai-field">
            用户名
            <input value={form.user} onChange={e => patch({ user: e.target.value })} placeholder="通常是邮箱地址" />
          </label>
          <label className="ai-field">
            密码 / 授权码
            <input
              type="password"
              value={form.pass}
              onChange={e => patch({ pass: e.target.value })}
              placeholder={config?.smtp.hasPass ? '已设置，留空则不修改' : 'SMTP 授权码'}
            />
          </label>
          <label className="ai-field">
            发件人
            <input value={form.from} onChange={e => patch({ from: e.target.value })} placeholder="留空则用用户名" />
          </label>
        </div>
      </details>
      </section>

      <div className="ai-sub-actions">
        <button type="button" className="ai-btn primary" onClick={onSave} disabled={saving || testing}>
          {saving ? '保存中…' : '保存订阅设置'}
        </button>
        <button type="button" className="ai-btn" onClick={onTest} disabled={saving || testing}>
          {testing ? '发送中…' : '发送测试邮件'}
        </button>
        <button type="button" className="ai-btn ghost" onClick={() => void load()} disabled={saving || testing}>
          刷新
        </button>
        {dirty
          ? <span className="ai-sub-dirty">● 有未保存的修改</span>
          : <span className="ai-sub-saved">已与保存的配置一致</span>}
      </div>

      <div className="ai-kv">
        <div className="ai-kv-row"><span>上次发送</span><code>{config?.lastSentAt ? formatTime(config.lastSentAt) : '—'}</code></div>
        <div className="ai-kv-row"><span>下次发送</span><code>{dirty ? '保存后重算' : (config?.enabled ? formatTime(config.nextSendAt) : '未开启')}</code></div>
        <div className="ai-kv-row"><span>最近结果</span><code>{config?.lastStatus || '—'}</code></div>
        <div className="ai-kv-row"><span>配置文件</span><code>{config?.file}</code></div>
      </div>
    </div>
  )
}

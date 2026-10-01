/*
 * @Description: 远程接入 · 消息推送渠道设置（飞书 / 钉钉 / 企业微信群机器人）
 *  - 每家一个卡片：启用、Webhook、签名密钥（飞书/钉钉）、随订阅推送、测试发送
 *  - Webhook / 密钥只存服务端，接口只回掩码；输入框留空表示不修改
 */
'use client'

import { useCallback, useEffect, useState } from 'react'

import type { Notify } from '@/lib/ai-client'

interface ChannelPublic {
  enabled: boolean
  hasWebhook: boolean
  webhookMasked: string
  hasSecret: boolean
  withSubscription: boolean
}

interface ChannelMeta {
  id: string
  label: string
  needsSecret: boolean
  secretLabel: string
  hint: string
}

interface ChannelsData {
  channels: Record<string, ChannelPublic>
  meta: ChannelMeta[]
  file: string
}

interface Draft {
  webhook: string
  secret: string
}

interface CardResult {
  ok: boolean
  text: string
}

export function ChannelsSettings({ notify }: { notify: Notify }) {
  const [data, setData] = useState<ChannelsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [busy, setBusy] = useState('')
  const [results, setResults] = useState<Record<string, CardResult>>({})
  const [titlesOnly, setTitlesOnly] = useState(false)

  const load = useCallback(async () => {
    try {
      const j = await fetch('/api/channels', { cache: 'no-store' }).then(r => r.json())
      setData(j?.data ?? null)
    }
    catch {
      setData(null)
    }
    finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const channels = data?.channels ?? {}
  const metas = data?.meta ?? []
  const draftOf = (id: string): Draft => drafts[id] ?? { webhook: '', secret: '' }
  const setDraft = (id: string, patch: Partial<Draft>) =>
    setDrafts(d => ({ ...d, [id]: { ...(d[id] ?? { webhook: '', secret: '' }), ...patch } }))

  const save = async (id: string, body: Record<string, unknown>, msg: string) => {
    setBusy(id)
    try {
      const res = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ [id]: body }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        notify(j?.msg || '保存失败', false)
        return
      }
      setData(j.data)
      if ('webhook' in body || 'secret' in body)
        setDraft(id, { webhook: '', secret: '' })
      notify(msg)
    }
    catch {
      notify('网络错误，请重试', false)
    }
    finally {
      setBusy('')
    }
  }

  const test = async (id: string) => {
    setBusy(id)
    try {
      const res = await fetch('/api/channels/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const j = await res.json().catch(() => ({}))
      const text = j?.msg || (res.ok ? '已发送' : '发送失败')
      setResults(r => ({ ...r, [id]: { ok: res.ok, text } }))
      notify(text, res.ok)
    }
    catch {
      setResults(r => ({ ...r, [id]: { ok: false, text: '网络错误' } }))
      notify('网络错误，请重试', false)
    }
    finally {
      setBusy('')
    }
  }

  const anyEnabled = metas.some(m => channels[m.id]?.enabled)

  const push = async () => {
    setBusy('push')
    try {
      const res = await fetch('/api/channels/push', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ titlesOnly }),
      })
      const j = await res.json().catch(() => ({}))
      notify(j?.msg || (res.ok ? '已推送' : '推送失败'), res.ok)
      if (j?.data?.results) {
        const next: Record<string, CardResult> = {}
        for (const r of j.data.results as { id: string, ok: boolean, error?: string }[])
          next[r.id] = { ok: r.ok, text: r.ok ? '推送成功' : (r.error || '推送失败') }
        setResults(prev => ({ ...prev, ...next }))
      }
    }
    catch {
      notify('网络错误，请重试', false)
    }
    finally {
      setBusy('')
    }
  }

  return (
    <section className="ai-card channels-settings">
      <h2>远程接入</h2>
      <p className="ai-srcinfo">
        把热榜推送到群机器人：<b>飞书</b> / <b>钉钉</b> / <b>企业微信</b>。配置好 Webhook 后可手动「推送当前热榜」，
        也可以勾选「随邮件订阅推送」，让定时订阅同时发到群里。
      </p>

      <div className="ch-push">
        <button type="button" className="ai-btn primary" onClick={() => void push()} disabled={busy === 'push' || !anyEnabled}>
          {busy === 'push' ? '推送中…' : '推送当前热榜'}
        </button>
        <label className="ai-check">
          <input type="checkbox" checked={titlesOnly} onChange={e => setTitlesOnly(e.target.checked)} />
          只推标题（更短）
        </label>
        {!anyEnabled && <span className="ai-hint">先在下面启用至少一个渠道</span>}
      </div>

      {loading && <div className="ai-empty">正在读取渠道配置…</div>}

      {metas.map((m) => {
        const c: ChannelPublic = channels[m.id] ?? { enabled: false, hasWebhook: false, webhookMasked: '', hasSecret: false, withSubscription: false }
        const draft = draftOf(m.id)
        const res = results[m.id]
        return (
          <section className="ch-card" key={m.id}>
            <div className="ch-head">
              <label className="ai-check">
                <input
                  type="checkbox"
                  checked={c.enabled}
                  disabled={busy === m.id}
                  onChange={e => void save(m.id, { enabled: e.target.checked }, e.target.checked ? `已启用「${m.label}」` : `已停用「${m.label}」`)}
                />
                {m.label}
              </label>
              <span className={`ai-badge ${c.enabled ? 'ok' : ''}`}>{c.enabled ? '已启用' : '未启用'}</span>
            </div>

            <div className="ai-field">
              <span>Webhook 地址</span>
              <input
                value={draft.webhook}
                onChange={e => setDraft(m.id, { webhook: e.target.value })}
                placeholder={c.hasWebhook ? `已配置 ${c.webhookMasked}（留空不修改）` : '粘贴群机器人 Webhook 地址'}
                spellCheck={false}
              />
            </div>

            {m.needsSecret && (
              <div className="ai-field">
                <span>{m.secretLabel}</span>
                <input
                  type="password"
                  value={draft.secret}
                  onChange={e => setDraft(m.id, { secret: e.target.value })}
                  placeholder={c.hasSecret ? '已配置（留空不修改）' : '未开启签名时可不填'}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            )}

            <label className="ai-check ch-sub">
              <input
                type="checkbox"
                checked={c.withSubscription}
                disabled={busy === m.id}
                onChange={e => void save(m.id, { withSubscription: e.target.checked }, e.target.checked ? '已加入订阅推送' : '已从订阅推送移除')}
              />
              随邮件订阅定时推送
            </label>

            <div className="ch-actions">
              <button
                type="button"
                className="ai-btn"
                onClick={() => void save(m.id, { webhook: draft.webhook, secret: draft.secret }, `「${m.label}」已保存`)}
                disabled={busy === m.id || (!draft.webhook.trim() && !draft.secret.trim())}
              >
                保存
              </button>
              <button
                type="button"
                className="ai-btn"
                onClick={() => void test(m.id)}
                disabled={busy === m.id || !c.hasWebhook}
                title={c.hasWebhook ? '发送一条测试消息' : '先保存 Webhook 再测试'}
              >
                {busy === m.id ? '发送中…' : '测试发送'}
              </button>
              {res && <span className={`ch-res ${res.ok ? 'ok' : 'err'}`}>{res.text}</span>}
            </div>

            <small className="ai-hint">{m.hint}</small>
          </section>
        )
      })}

      {data?.file && <div className="ai-hint ch-file">配置文件：{data.file}</div>}
    </section>
  )
}

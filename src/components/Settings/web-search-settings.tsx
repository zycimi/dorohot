/* Web search provider and credentials settings. Keys are only sent to server-side APIs. */
'use client'

import { useEffect, useState } from 'react'

import { post } from '@/lib/ai-client'

import type { Notify, PublicWebSearchSettings } from '@/lib/ai-client'

type ProviderValue = PublicWebSearchSettings['provider']

/** 兜底列表（/api/ai/status 未回来时用），与服务端 WEB_SEARCH_PROVIDERS 保持一致 */
const FALLBACK_PROVIDERS: { value: ProviderValue, label: string }[] = [
  { value: 'bing-rss', label: 'Bing RSS' },
  { value: 'google-cse', label: 'Google CSE' },
  { value: 'exa', label: 'Exa' },
  { value: 'firecrawl', label: 'Firecrawl' },
  { value: 'parallel', label: 'Parallel' },
  { value: 'tavily', label: 'Tavily' },
]

/** 每个搜索源的「就绪状态」标签：无需 Key / 已配置 / 需配置 Key / 缺 CX */
function providerTag(value: ProviderValue, status?: PublicWebSearchSettings): { text: string, cls: string } {
  if (value === 'bing-rss')
    return { text: '无需 Key', cls: 'ok' }
  const key = status?.apiKeys?.[value]
  if (!key?.hasApiKey)
    return { text: '需配置 Key', cls: 'gray' }
  if (value === 'google-cse' && !status?.googleCxConfigured)
    return { text: '缺 CX', cls: 'warn' }
  return { text: key.envLocked ? '环境变量' : '已配置', cls: 'ok' }
}

export function WebSearchSettings({ initial, notify, onChanged }: { initial?: PublicWebSearchSettings, notify: Notify, onChanged: () => void }) {
  const [status, setStatus] = useState<PublicWebSearchSettings | undefined>(initial)
  const [provider, setProvider] = useState<ProviderValue>(initial?.provider ?? 'bing-rss')
  const [apiKey, setApiKey] = useState('')
  const [googleCx, setGoogleCx] = useState(initial?.googleCx ?? '')
  const [enabled, setEnabled] = useState(initial?.enabled ?? false)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('OpenCode websearch providers')
  const [testResult, setTestResult] = useState<Array<{ title: string, url: string, snippet: string }> | null>(null)

  useEffect(() => {
    if (!initial)
      return
    setStatus(initial)
    if (initial.provider)
      setProvider(initial.provider)
    setEnabled(initial.enabled)
    setGoogleCx(initial.googleCx ?? '')
  }, [initial])

  const save = async (
    overrides: { enabled?: boolean, provider?: string, apiKey?: string, clearApiKey?: boolean, googleCx?: string } = {},
    options: { quiet?: boolean } = {},
  ) => {
    setBusy(true)
    try {
      const result = await post<PublicWebSearchSettings>('/api/ai/web-search', {
        enabled: overrides.enabled ?? enabled,
        provider: overrides.provider ?? provider,
        ...((overrides.apiKey ?? apiKey).trim() ? { apiKey: (overrides.apiKey ?? apiKey).trim() } : {}),
        googleCx: overrides.googleCx ?? googleCx,
        ...overrides,
      })
      if (result.enabled && result.provider !== 'bing-rss' && !result.hasApiKey) {
        setEnabled(false)
        setStatus({ ...result, enabled: false })
        notify('已保存搜索源；需先配置该源的 API Key 才能启用', false)
        onChanged()
        return { ...result, enabled: false }
      }
      if (result.enabled && result.provider === 'google-cse' && (!result.googleCxConfigured || !result.hasApiKey)) {
        setEnabled(false)
        setStatus({ ...result, enabled: false })
        notify('Google CSE 需要 API Key 与搜索引擎 ID（CX）才能启用', false)
        onChanged()
        return { ...result, enabled: false }
      }
      setStatus(result)
      setEnabled(result.enabled)
      setProvider(result.provider)
      setGoogleCx(result.googleCx ?? '')
      setApiKey('')
      onChanged()
      if (!options.quiet)
        notify('联网搜索设置已保存')
      return result
    }
    catch (error) {
      notify(error instanceof Error ? error.message : '保存联网搜索设置失败', false)
      return null
    }
    finally {
      setBusy(false)
    }
  }

  const testSearch = async () => {
    const q = query.trim()
    if (!q)
      return notify('请先输入测试搜索词', false)
    setTestResult(null)
    try {
      // Save pending provider/key first. Search API only reads server-side configuration.
      const next = provider === 'bing-rss'
        ? await save({ provider: 'bing-rss', enabled }, { quiet: true })
        : await save({ enabled: true }, { quiet: true })
      if (!next || (provider !== 'bing-rss' && !next.enabled))
        return
      setBusy(true)
      const result = await post<{ provider: string, aiContextAllowed?: boolean, results: Array<{ title: string, url: string, snippet: string }> }>('/api/ai/web-search/query', { query: q, limit: 5 })
      setTestResult(result.results)
      notify(`${result.provider} 搜索成功，返回 ${result.results.length} 条结果${result.aiContextAllowed === false ? '（仅用于页面展示，不用于 AI 对话）' : ''}`)
    }
    catch (error) {
      notify(error instanceof Error ? error.message : '联网搜索测试失败', false)
    }
    finally {
      setBusy(false)
    }
  }

  const currentKeyStatus = status?.apiKeys?.[provider]
  const keyExists = !!currentKeyStatus?.hasApiKey && !apiKey.trim()
  const providers = status?.providerOptions ?? FALLBACK_PROVIDERS
  const cxReady = provider !== 'google-cse' || !!googleCx.trim() || !!status?.googleCxConfigured
  const ready = (provider === 'bing-rss' || keyExists || !!apiKey.trim()) && cxReady
  const badge = enabled
    ? (ready ? { text: '已启用', cls: 'ok' } : { text: '待配置 Key', cls: 'warn' })
    : { text: '已停用', cls: 'gray' }

  return (
    <section className="ai-card web-search-settings">
      <div className="ws-head">
        <h2>联网搜索</h2>
        <span className={`ai-badge ${badge.cls}`}>{badge.text}</span>
      </div>
      <p className="ai-srcinfo">
        为 AI 对话提供实时网页检索：聊天中打开「联网搜索」后，系统先搜索网页，再把结果与来源链接交给模型。API Key 只保存在服务端配置文件中。
      </p>

      <label className="ws-toggle">
        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
        <span>启用联网搜索</span>
        <small>聊天里的开关是粘性的，这里决定默认配置</small>
      </label>

      <div className="ws-section-label">搜索源</div>
      <div className="ws-providers" role="radiogroup" aria-label="搜索源">
        {providers.map((item) => {
          const tag = providerTag(item.value, status)
          return (
            <label key={item.value} className={`ws-provider ${provider === item.value ? 'on' : ''}`}>
              <input
                type="radio"
                name="ws-provider"
                value={item.value}
                checked={provider === item.value}
                onChange={() => setProvider(item.value)}
              />
              <span className="ws-provider-name">{item.label}</span>
              <span className={`ai-badge ${tag.cls} ws-provider-tag`}>{tag.text}</span>
            </label>
          )
        })}
      </div>

      {provider !== 'bing-rss' && (
        <label className="ai-field ws-cred">
          <span>API Key</span>
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder={keyExists ? currentKeyStatus?.apiKeyMasked || '已配置（留空保持不变）' : `填写 ${provider.toUpperCase()} API Key`}
            autoComplete="new-password"
            disabled={!!currentKeyStatus?.envLocked}
          />
          {currentKeyStatus?.envLocked && <small className="ai-hint">当前搜索源的 Key 由环境变量提供，设置文件中的值不会覆盖它。</small>}
        </label>
      )}

      {provider === 'google-cse' && (
        <label className="ai-field ws-cred">
          <span>Google 搜索引擎 ID（CX）</span>
          <input value={googleCx} onChange={e => setGoogleCx(e.target.value)} placeholder={status?.googleCxConfigured ? '已配置（留空保持不变）' : '在 Programmable Search Engine 控制台复制 CX'} disabled={status?.googleCxEnvLocked} />
          <small className="ai-hint">Google Custom Search JSON API 需要 API Key 与 CX。</small>
        </label>
      )}

      {provider === 'bing-rss' && (
        <div className="ai-hint ws-note">
          无需 API Key，可直接用于 AI 对话的联网搜索（结果来自 Bing RSS）。注意：Bing Search API 已于 2025-08-11 退役；RSS 结果的条款为个人非商业用途，请勿公开再分发。
        </div>
      )}

      {provider === 'google-cse' && (
        <div className="ai-warn ws-note">Google Custom Search JSON API 已停止新用户注册；现有用户服务计划于 2027-01-01 停止。使用前需确认已有 Google API 与 Programmable Search Engine 权限。</div>
      )}

      <div className="ai-opts">
        <button type="button" className="ai-btn primary" onClick={() => void save()} disabled={busy}>
          {busy ? '保存中…' : '保存联网搜索设置'}
        </button>
        {keyExists && !currentKeyStatus?.envLocked && (
          <button type="button" className="ai-btn" onClick={() => void save({ clearApiKey: true })} disabled={busy}>
            清除当前搜索源 Key
          </button>
        )}
      </div>

      <div className="ws-test">
        <div className="ws-section-label">测试搜索</div>
        <div className="ai-memory-search">
          <input value={query} onChange={e => setQuery(e.target.value)} aria-label="测试搜索词" />
          <button type="button" className="ai-btn mini" onClick={() => void testSearch()} disabled={busy || (provider !== 'bing-rss' && !currentKeyStatus?.hasApiKey && !apiKey.trim()) || (provider === 'google-cse' && !googleCx.trim() && !status?.googleCxConfigured)}>
            {busy ? '搜索中…' : '测试搜索'}
          </button>
        </div>
      </div>

      {testResult && (
        <ol className="web-search-test-results">
          {testResult.map((item, index) => (
            <li key={`${item.url}-${index}`}>
              <a href={item.url} target="_blank" rel="noreferrer">{item.title || item.url}</a>
              {item.snippet && <p>{item.snippet}</p>}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

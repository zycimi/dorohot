/*
 * @Description: MCP 接入设置
 *  布局（2026-10-01 调整）：接入信息（开关 / 地址 / 令牌 / 客户端示例）在上，「提供的能力」置底。
 */
'use client'

import { useCallback, useEffect, useState } from 'react'

import { copyText } from '@/lib/clipboard'
import { formatLocalDateTime } from '@/lib/format'

import type { Notify } from '@/lib/ai-client'

interface TokenInfo {
  id: string
  name: string
  prefix: string
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

interface ToolInfo {
  name: string
  description: string
  enabled: boolean
}

const fmtTime = (iso: string | null) => formatLocalDateTime(iso)

export function McpSettings({ notify }: { notify: Notify }) {
  const [enabled, setEnabled] = useState(true)
  const [tokens, setTokens] = useState<TokenInfo[]>([])
  const [tools, setTools] = useState<ToolInfo[]>([])
  const [endpoint, setEndpoint] = useState('/api/mcp')
  const [origin, setOrigin] = useState('')
  const [name, setName] = useState('')
  const [created, setCreated] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const [cfg, tok] = await Promise.all([
        fetch('/api/mcp/config', { cache: 'no-store' }).then(r => r.json()),
        fetch('/api/mcp/tokens', { cache: 'no-store' }).then(r => r.json()),
      ])
      setEnabled(!!cfg?.data?.enabled)
      setTools(Array.isArray(cfg?.data?.tools) ? cfg.data.tools : [])
      setEndpoint(cfg?.data?.endpoint || '/api/mcp')
      setTokens(Array.isArray(tok?.data?.tokens) ? tok.data.tokens : [])
    }
    catch {
      // 忽略：接口未就绪时按默认展示
    }
    finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setOrigin(window.location.origin)
    void load()
  }, [load])

  const postJson = (url: string, body: unknown, method = 'POST') =>
    fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

  /** 保存能力开关（逐个或批量共用） */
  const saveTools = async (patch: Record<string, boolean>, done: string) => {
    setBusy(true)
    setTools(prev => prev.map(t => (t.name in patch ? { ...t, enabled: patch[t.name] } : t)))
    try {
      const res = await postJson('/api/mcp/config', { tools: patch })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        notify(j?.msg || '保存失败', false)
        await load()
        return
      }
      if (Array.isArray(j?.data?.tools))
        setTools(j.data.tools)
      notify(done)
    }
    catch {
      notify('网络错误', false)
      await load()
    }
    finally {
      setBusy(false)
    }
  }

  const toggleMcp = async (next: boolean) => {
    setBusy(true)
    try {
      const res = await postJson('/api/mcp/config', { enabled: next })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        notify(j?.msg || '保存失败', false)
        return
      }
      setEnabled(!!j?.data?.enabled)
      notify(j?.msg || '已保存')
    }
    finally {
      setBusy(false)
    }
  }

  const toggleTool = (toolName: string, next: boolean) =>
    saveTools({ [toolName]: next }, next ? `已启用：${toolName}` : `已关闭：${toolName}`)

  const setAllTools = (next: boolean) => {
    if (!tools.length)
      return
    const patch = Object.fromEntries(tools.map(t => [t.name, next]))
    return saveTools(patch, next ? '已启用全部能力' : '已停用全部能力')
  }

  const create = async () => {
    setBusy(true)
    try {
      const res = await postJson('/api/mcp/tokens', { name })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        notify(j?.msg || '创建失败', false)
        return
      }
      setCreated(typeof j?.data?.token === 'string' ? j.data.token : '')
      setName('')
      if (j?.data?.info)
        setTokens(prev => [j.data.info as TokenInfo, ...prev])
      notify('令牌已创建')
    }
    finally {
      setBusy(false)
    }
  }

  const patchToken = async (id: string, action: 'revoke' | 'restore') => {
    setBusy(true)
    try {
      const res = await postJson('/api/mcp/tokens', { id, action }, 'PATCH')
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        notify(j?.msg || '操作失败', false)
        return
      }
      setTokens(Array.isArray(j?.data?.tokens) ? j.data.tokens : [])
      notify(action === 'revoke' ? '已吊销（可恢复或删除）' : '已恢复')
    }
    finally {
      setBusy(false)
    }
  }

  const removeToken = async (id: string) => {
    if (!window.confirm('删除后不可恢复，确定删除该已吊销令牌？'))
      return
    setBusy(true)
    try {
      const res = await fetch(`/api/mcp/tokens?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        notify(j?.msg || '删除失败', false)
        return
      }
      setTokens(Array.isArray(j?.data?.tokens) ? j.data.tokens : [])
      notify('已删除')
    }
    finally {
      setBusy(false)
    }
  }

  const url = `${origin}${endpoint}`
  const snippet = JSON.stringify(
    { mcpServers: { dorohot: { url, headers: { Authorization: 'Bearer <你的令牌>' } } } },
    null,
    2,
  )
  const activeCount = tokens.filter(t => !t.revokedAt).length
  const enabledToolCount = tools.filter(t => t.enabled).length

  return (
    <section className="ai-card mcp-settings">
      <h2>MCP 接入</h2>
      <p className="ai-srcinfo">
        把本站作为 <b>MCP 服务端</b>，供 Claude Desktop / Cursor / Claude Code 等客户端接入。
      </p>

      <label className="ai-check mcp-switch">
        <input type="checkbox" checked={enabled} disabled={busy} onChange={e => void toggleMcp(e.target.checked)} />
        <span>启用 MCP 接入</span>
        <span className={`mcp-badge ${enabled ? 'on' : 'off'}`}>{enabled ? '已启用' : '已停用'}</span>
      </label>

      <div className="ai-field">
        <span>服务地址（Streamable HTTP）</span>
        <div className="mcp-copy">
          <code>{url}</code>
          <button type="button" className="ai-btn mini" onClick={() => void copyText(url).then(ok => notify(ok ? '已复制地址' : '复制失败', ok))}>复制</button>
        </div>
        <small className="ai-hint">认证：每个请求都必须带请求头 Authorization: Bearer &lt;令牌&gt;。</small>
      </div>

      <div className="ai-field">
        <span>访问令牌</span>
        <div className="mcp-token-new">
          <input value={name} placeholder="给令牌起个名字（如 Claude Desktop）" onChange={e => setName(e.target.value)} />
          <button type="button" className="ai-btn primary" onClick={() => void create()} disabled={busy}>生成令牌</button>
        </div>
        {created && (
          <div className="mcp-created">
            <div className="mcp-created-head">新令牌（仅显示这一次，请立即复制）：</div>
            <div className="mcp-copy">
              <code>{created}</code>
              <button type="button" className="ai-btn mini" onClick={() => void copyText(created).then(ok => notify(ok ? '已复制令牌' : '复制失败', ok))}>复制</button>
            </div>
          </div>
        )}
      </div>

      <div className="ai-field">
        <span>已签发令牌（有效 {loading ? '-' : `${activeCount} / ${tokens.length}`}）</span>
        {loading
          ? <div className="mcp-skeleton">{Array.from({ length: 3 }, (_, i) => <span key={i} />)}</div>
          : tokens.length === 0
            ? <div className="ai-empty">还没有令牌。生成一枚后即可在客户端中使用。</div>
            : (
              <div className="mcp-table-wrap">
                <table className="mcp-table">
                  <thead>
                    <tr><th>名称</th><th>前缀</th><th>状态</th><th>创建</th><th>最近使用</th><th>操作</th></tr>
                  </thead>
                  <tbody>
                    {tokens.map(t => (
                      <tr key={t.id} className={t.revokedAt ? 'mcp-row-revoked' : undefined}>
                        <td>{t.name || '未命名'}</td>
                        <td><code>{t.prefix}</code></td>
                        <td>{t.revokedAt ? <span className="mcp-badge off">已吊销</span> : <span className="mcp-badge on">有效</span>}</td>
                        <td className="mcp-num">{fmtTime(t.createdAt)}</td>
                        <td className="mcp-num">{t.revokedAt ? '-' : fmtTime(t.lastUsedAt)}</td>
                        <td className="mcp-actions">
                          {t.revokedAt
                            ? (
                                <>
                                  <button type="button" className="ai-btn mini" onClick={() => void patchToken(t.id, 'restore')} disabled={busy}>恢复</button>
                                  <button type="button" className="ai-btn mini ghost danger" onClick={() => void removeToken(t.id)} disabled={busy}>删除</button>
                                </>
                              )
                            : (
                                <button type="button" className="ai-btn mini ghost" onClick={() => void patchToken(t.id, 'revoke')} disabled={busy} title="吊销后可恢复或删除">吊销</button>
                              )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        <small className="ai-hint">有效令牌只能吊销；吊销后可恢复或删除。只有已吊销的令牌才能删除。</small>
      </div>

      <div className="ai-field">
        <span>客户端配置示例</span>
        <div className="mcp-copy">
          <pre>{snippet}</pre>
          <button type="button" className="ai-btn mini" onClick={() => void copyText(snippet).then(ok => notify(ok ? '已复制配置' : '复制失败', ok))}>复制</button>
        </div>
        <small className="ai-hint">
          支持 HTTP MCP 的客户端直接填 `url` + `headers`；Claude Desktop 需用 `npx mcp-remote {url || '<地址>'} --header "Authorization: Bearer &lt;令牌&gt;"` 桥接。
        </small>
      </div>

      <div className="ai-field mcp-cap">
        <div className="mcp-cap-head">
          <span>提供的能力（已启用 {loading ? '-' : `${enabledToolCount} / ${tools.length}`}）</span>
          <div className="mcp-cap-actions">
            <button type="button" className="ai-btn mini" onClick={() => void setAllTools(true)} disabled={busy || !tools.length || enabledToolCount === tools.length}>全部启用</button>
            <button type="button" className="ai-btn mini" onClick={() => void setAllTools(false)} disabled={busy || !tools.length || enabledToolCount === 0}>全部停用</button>
          </div>
        </div>
        <div className="mcp-tools">
          {loading
            ? <div className="mcp-skeleton">{Array.from({ length: 4 }, (_, i) => <span key={i} />)}</div>
            : tools.map(t => (
                <label className="mcp-tool" key={t.name}>
                  <input
                    type="checkbox"
                    checked={t.enabled}
                    disabled={busy}
                    onChange={e => void toggleTool(t.name, e.target.checked)}
                  />
                  <span className="mcp-tool-main">
                    <code>{t.name}</code>
                    <span className="mcp-tool-desc">{t.description}</span>
                  </span>
                </label>
              ))}
        </div>
        <small className="ai-hint">
          关闭的能力不会出现在 MCP 客户端的工具列表里，调用也会被拒绝；取消勾选即可停用。
          {!enabled && '（MCP 接入当前已停用，能力将在启用后生效）'}
        </small>
      </div>
    </section>
  )
}

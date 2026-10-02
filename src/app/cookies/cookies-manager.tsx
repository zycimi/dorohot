'use client'

/*
 * @Description: Cookies 管理客户端组件（NGA/微博/小黑盒）
 * API: GET /api/cookies/sources · GET|POST /api/cookies/sources/{id} ·
 *      POST /api/cookies/sources/{id}/entries · PUT|DELETE .../entries/{index}
 */
import { useCallback, useEffect, useState } from 'react'

import { copyText } from '@/lib/clipboard'
import { formatLocalDateTime } from '@/lib/format'

interface CookieSourceInfo {
  id: string
  label: string
  file: string
  site: string
  note: string
  exists: boolean
  count: number
  mtime: string | null
}

interface CookieItem {
  index: number
  name: string
  value: string
  domain: string
  path: string
  expiresAt: string | null
  expired: boolean
  session: boolean
  createdAt: string
  updatedAt: string
}

interface ProbeState {
  state: 'loading' | 'ok' | 'fail' | 'unsupported'
  detail?: string
}

const fmtTime = (iso: string | null) => formatLocalDateTime(iso, false)

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

export default function CookiesManager() {
  const [sources, setSources] = useState<CookieSourceInfo[]>([])
  const [cur, setCur] = useState<string>('')
  const [entries, setEntries] = useState<CookieItem[]>([])
  const [revealed, setRevealed] = useState<Set<number>>(new Set())
  const [importText, setImportText] = useState('')
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')
  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<number | null>(null)
  const [probe, setProbe] = useState<ProbeState | null>(null)
  const [toast, setToast] = useState<{ msg: string, ok: boolean } | null>(null)

  const notify = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok })
    window.setTimeout(() => setToast(null), ok ? 2600 : 5200)
  }, [])

  const api = useCallback(async (path: string, opts?: RequestInit) => {
    const res = await fetch(path, opts)
    const j = await res.json().catch(() => ({}))
    if (!res.ok)
      throw new Error(j.error || String(res.status))
    return j
  }, [])

  const reloadSources = useCallback(async () => {
    const list: CookieSourceInfo[] = await api('/api/cookies/sources')
    setSources(list)
    return list
  }, [api])

  const load = useCallback(async (id: string) => {
    try {
      const j = await api(`/api/cookies/sources/${id}`)
      setEntries(j.entries)
      setRevealed(new Set())
      setEditing(null)
    }
    catch (e) {
      notify(`加载失败: ${(e as Error).message}`, false)
    }
  }, [api, notify])

  useEffect(() => {
    (async () => {
      try {
        const list = await reloadSources()
        if (list.length) {
          setCur(list[0].id)
          await load(list[0].id)
        }
      }
      catch (e) {
        notify(`初始化失败: ${(e as Error).message}`, false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pick = async (id: string) => {
    setCur(id)
    setProbe(null)
    await load(id)
  }

  const doProbe = async () => {
    setProbe({ state: 'loading' })
    try {
      const r: ProbeState = await api(`/api/cookies/sources/${cur}/check`, { method: 'POST' })
      setProbe(r)
    }
    catch (e) {
      setProbe({ state: 'fail', detail: (e as Error).message })
    }
  }

  const refreshAll = async () => {
    await reloadSources()
    await load(cur)
    notify('已刷新')
  }

  const doImport = async () => {
    if (!importText.trim())
      return notify('请先粘贴 cookie 内容', false)
    try {
      const r = await api(`/api/cookies/sources/${cur}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: importText, mode }),
      })
      setImportText('')
      const fmtName = { json: 'JSON', tsv: 'TSV/Netscape', header: 'Cookie 头' }[r.format as 'json'] as string
      notify(`导入成功（识别为${fmtName}，${r.mode === 'replace' ? '覆盖' : '合并'} ${r.imported} 条，现共 ${r.total} 条）`)
      await reloadSources()
      await load(cur)
    }
    catch (e) {
      notify(`导入失败: ${(e as Error).message}`, false)
    }
  }

  const doDelete = async (item: CookieItem) => {
    if (!window.confirm(`确定删除「${item.name}」？原文件会先备份为 .bak。`))
      return
    try {
      await api(`/api/cookies/sources/${cur}/entries/${item.index}`, { method: 'DELETE' })
      notify('已删除')
      await reloadSources()
      await load(cur)
    }
    catch (e) {
      notify(`删除失败: ${(e as Error).message}`, false)
    }
  }

  const curSource = sources.find(s => s.id === cur)

  return (
    <div className="ca-wrap">
      <style>{caStyles}</style>
      <h1>Cookies 管理</h1>
      <div className="ca-sub">
        直接读写各爬虫项目目录下的 *_cookies.json；每次保存前自动备份为 .bak。爬虫/MCP 服务读到的是磁盘文件，改完即对下次请求生效（个别服务若有内存缓存，需重启对应服务）。
      </div>

      <div className="ca-tabs">
        {sources.map(s => (
          <button key={s.id} type="button" className={`ca-tab ${s.id === cur ? 'active' : ''}`} onClick={() => pick(s.id)}>
            {s.label}
            <span className="ca-cnt">{s.count >= 0 ? `${s.count} 条` : '读取失败'}</span>
          </button>
        ))}
      </div>

      <div className="ca-card">
        <h2>导入 cookies</h2>
        <div className="ca-srcinfo">
          {curSource?.file}
          {curSource?.mtime ? `   ·   上次修改 ${fmtTime(curSource.mtime)}` : ''}
          {curSource ? `   ·   ${curSource.note}` : ''}
        </div>
        {probe && (
          <div className="ca-probe">
            {probe.state === 'loading' && <span className="ca-badge gray">探测中…</span>}
            {probe.state === 'ok' && <span className="ca-badge ok" title={probe.detail}>登录态有效</span>}
            {probe.state === 'fail' && <span className="ca-badge bad" title={probe.detail}>登录态异常</span>}
            {probe.state === 'unsupported' && <span className="ca-badge gray" title={probe.detail}>不支持在线探测</span>}
            <span className="ca-probe-detail">{probe.state === 'loading' ? '正在请求站点接口实测…' : probe.detail}</span>
          </div>
        )}
        <textarea
          className="ca-import"
          value={importText}
          onChange={e => setImportText(e.target.value)}
          placeholder={'支持三种格式（自动识别）：\n1. 浏览器插件导出的 JSON 数组\n2. Cookie 头字符串：ngaPassportUid=xxx; ngaPassportCid=yyy\n3. Netscape / TSV 文本（cookie.txt 或制表符分隔）'}
        />
        <div className="ca-opts">
          <label className="ca-radio">
            <input type="radio" checked={mode === 'merge'} onChange={() => setMode('merge')} />
            合并（同名覆盖，其余保留）
          </label>
          <label className="ca-radio">
            <input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} />
            覆盖全部
          </label>
          <button type="button" className="ca-btn primary" onClick={doImport}>导入</button>
          <button type="button" className="ca-btn" onClick={() => setAddOpen(v => !v)}>添加单条</button>
          <button type="button" className="ca-btn" onClick={doProbe} disabled={probe?.state === 'loading'}>检测登录态</button>
          <button type="button" className="ca-btn" onClick={refreshAll}>刷新</button>
        </div>
        {addOpen && <AddForm api={api} cur={cur} onDone={async (msg) => {
          notify(msg)
          setAddOpen(false)
          await reloadSources()
          await load(cur)
        }} onError={m => notify(m, false)} />}
      </div>

      <div className="ca-card">
        <h2>Cookie 列表</h2>
        <div style={{ overflowX: 'auto' }}>
          <table className="ca-table">
            <thead>
              <tr>
                <th>名称</th><th>值</th><th>过期时间</th><th>更新</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {editing !== null
                ? null
                : entries.length
                  ? entries.map(e => (
                    <tr key={e.index}>
                      <td>
                        <div className="ca-name">{esc(e.name)}</div>
                        <div className="ca-subline" title={e.path ? `${e.domain || ''}${e.path}` : (e.domain || '')}>
                          {e.domain || '—'}{e.path ? ` / ${e.path.replace(/^\//, '')}` : ''}
                        </div>
                      </td>
                      <td className="ca-val">
                        <span className={`ca-valtext ca-mono${revealed.has(e.index) ? '' : ' ca-masked'}`} title={e.value}>
                          {revealed.has(e.index)
                            ? (e.value.length > 120 ? `${e.value.slice(0, 120)}…` : e.value)
                            : `${esc(e.value.slice(0, 3))}${'•'.repeat(5)}`}
                        </span>
                        <span className="ca-valbtns">
                          <button type="button" className="ca-btn ghost" onClick={() => {
                            const next = new Set(revealed)
                            next.has(e.index) ? next.delete(e.index) : next.add(e.index)
                            setRevealed(next)
                          }}
                          >
                            {revealed.has(e.index) ? '隐藏' : '显示'}
                          </button>
                          <button type="button" className="ca-btn ghost" onClick={() => copyVal(e.value, notify)}>复制</button>
                        </span>
                      </td>
                      <td>{expiryCell(e, probe?.state === 'ok')}</td>
                      <td className="ca-time" title={`创建 ${fmtTime(e.createdAt)}`}>{fmtTime(e.updatedAt)}</td>
                      <td className="ca-rowbtns">
                        <button type="button" className="ca-btn ghost" onClick={() => setEditing(e.index)}>编辑</button>
                        <button type="button" className="ca-btn ghost danger" onClick={() => doDelete(e)}>删除</button>
                      </td>
                    </tr>
                  ))
                  : <tr><td colSpan={5} className="ca-empty">暂无 cookie，用上方导入或「添加单条」</td></tr>}
            </tbody>
          </table>
        </div>
        {editing !== null && (
          <EditForm
            item={entries.find(e => e.index === editing)!}
            api={api}
            cur={cur}
            onCancel={() => setEditing(null)}
            onDone={async (msg) => {
              notify(msg)
              await reloadSources()
              await load(cur)
            }}
            onError={m => notify(m, false)}
          />
        )}
      </div>

      {toast && <div className={`ca-toast ${toast.ok ? 'ok' : 'err'}`}>{toast.msg}</div>}
    </div>
  )
}

function expiryCell(e: CookieItem, probeOk = false) {
  if (!e.expiresAt)
    return <span className="ca-badge gray">会话</span>
  if (e.expired) {
    // 登录态探测有效时，快照过期只作参考信息（站点会对短时令牌自动续期）
    return probeOk
      ? <span><span className="ca-badge gray" title="登录态探测有效；该站会对短时令牌自动续期，快照到期时间仅供参考">快照已到期</span> {fmtTime(e.expiresAt)}</span>
      : <span><span className="ca-badge bad">已过期</span> {fmtTime(e.expiresAt)}</span>
  }
  const days = (new Date(e.expiresAt).getTime() - Date.now()) / 86400000
  const cls = days < 3 ? 'bad' : days < 7 ? 'warn' : 'ok'
  const d = days < 1 ? `${Math.round(days * 24)} 小时` : `${Math.floor(days)} 天`
  return <span><span className={`ca-badge ${cls}`}>{`剩 ${d}`}</span> {fmtTime(e.expiresAt)}</span>
}

async function copyVal(v: string, notify: (m: string, ok?: boolean) => void) {
  const ok = await copyText(v)
  notify(ok ? '已复制到剪贴板' : '复制失败，请手动选择文本后复制', ok)
}

const toLocalInput = (iso: string) => {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

interface FormProps {
  api: (path: string, opts?: RequestInit) => Promise<any>
  cur: string
  onDone: (msg: string) => void
  onError: (msg: string) => void
  onCancel?: () => void
  item?: CookieItem
}

function AddForm({ api, cur, onDone, onError }: FormProps) {
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [domain, setDomain] = useState('')
  const [path, setPath] = useState('/')
  const [exp, setExp] = useState('')

  const save = async () => {
    if (!name.trim() || !value)
      return onError('name / value 必填')
    const body: Record<string, unknown> = { name: name.trim(), value, domain: domain.trim(), path: path.trim() || '/' }
    if (exp)
      body.expirationDate = Math.floor(new Date(exp).getTime() / 1000)
    try {
      await api(`/api/cookies/sources/${cur}/entries`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      onDone('已添加')
    }
    catch (e) {
      onError(`添加失败: ${(e as Error).message}`)
    }
  }

  return (
    <div className="ca-addform">
      <input type="text" placeholder="name（必填）" value={name} onChange={e => setName(e.target.value)} />
      <input type="text" placeholder="value（必填）" value={value} onChange={e => setValue(e.target.value)} />
      <input type="text" placeholder="domain（默认站点域）" value={domain} onChange={e => setDomain(e.target.value)} />
      <input type="text" placeholder="/" value={path} onChange={e => setPath(e.target.value)} />
      <input type="datetime-local" title="留空 = 会话 cookie" value={exp} onChange={e => setExp(e.target.value)} />
      <button type="button" className="ca-btn primary" onClick={save}>保存</button>
    </div>
  )
}

function EditForm({ item, api, cur, onDone, onError, onCancel }: FormProps) {
  const [name, setName] = useState(item.name)
  const [value, setValue] = useState(item.value)
  const [domain, setDomain] = useState(item.domain)
  const [path, setPath] = useState(item.path)
  const [session, setSession] = useState(!item.expiresAt)
  const [exp, setExp] = useState(item.expiresAt ? toLocalInput(item.expiresAt) : '')

  const save = async () => {
    const body = {
      name: name.trim(),
      value,
      domain: domain.trim(),
      path: path.trim(),
      expiresAt: session ? null : (exp ? new Date(exp).toISOString() : null),
    }
    try {
      await api(`/api/cookies/sources/${cur}/entries/${item.index}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      onDone('已保存（原文件已备份 .bak）')
    }
    catch (e) {
      onError(`保存失败: ${(e as Error).message}`)
    }
  }

  return (
    <div className="ca-edit">
      <div className="ca-editgrid">
        <span className="lbl">name</span>
        <input type="text" value={name} onChange={e => setName(e.target.value)} />
        <span className="lbl">value</span>
        <textarea value={value} onChange={e => setValue(e.target.value)} />
        <span className="lbl">domain</span>
        <input type="text" value={domain} onChange={e => setDomain(e.target.value)} />
        <span className="lbl">path</span>
        <input type="text" value={path} onChange={e => setPath(e.target.value)} />
        <span className="lbl">过期时间</span>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <label className="ca-radio">
            <input type="checkbox" checked={session} onChange={e => setSession(e.target.checked)} />
            会话 cookie（无过期）
          </label>
          <input type="datetime-local" value={exp} disabled={session} onChange={e => setExp(e.target.value)} style={{ maxWidth: 230 }} />
        </div>
      </div>
      <div className="ca-editbtns">
        <button type="button" className="ca-btn primary" onClick={save}>保存</button>
        <button type="button" className="ca-btn" onClick={onCancel}>取消</button>
      </div>
    </div>
  )
}

const caStyles = `
.ca-wrap { max-width: 1080px; margin: 0 auto; padding: 20px 16px 60px; }
.ca-wrap h1 { font-size: 20px; margin: 0 0 4px; }
.ca-sub { color: var(--muted); font-size: 12px; margin-bottom: 16px; }
.ca-tabs { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }
.ca-tab { padding: 8px 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: inherit; cursor: pointer; font-size: 14px; }
.ca-tab:hover { border-color: color-mix(in oklab, var(--accent) 35%, var(--border)); }
.ca-tab.active { border-color: var(--accent); color: var(--accent); font-weight: 600; background: color-mix(in oklab, var(--accent) 8%, var(--surface)); }
.ca-cnt { color: var(--muted); font-size: 12px; margin-left: 4px; }
.ca-card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; margin-bottom: 16px; }
.ca-card h2 { font-size: 15px; margin: 0 0 10px; }
.ca-srcinfo { font-size: 12px; color: var(--muted); margin-bottom: 10px; word-break: break-all; }
.ca-probe { display: flex; gap: 8px; align-items: center; margin: -4px 0 10px; font-size: 12px; }
.ca-probe-detail { color: var(--muted); word-break: break-all; }
.ca-table { width: 100%; border-collapse: collapse; }
.ca-table th { text-align: left; padding: 8px 12px; color: var(--muted); font-weight: 500; font-size: 12px; white-space: nowrap; border-bottom: 1px solid var(--separator); }
.ca-table td { text-align: left; padding: 12px; border-bottom: 1px solid var(--separator); vertical-align: middle; font-size: 13px; }
.ca-table tbody tr:last-child td { border-bottom: none; }
.ca-table tbody tr { transition: background 0.15s; }
.ca-table tbody tr:hover { background: color-mix(in oklab, var(--accent) 6%, transparent); }
.ca-name { font-weight: 600; font-size: 13px; }
.ca-subline { color: var(--muted); font-size: 11px; margin-top: 2px; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ca-mono, .ca-valtext { font-family: ui-monospace, Menlo, Consolas, monospace; }
.ca-val { display: flex; align-items: center; gap: 6px; max-width: 340px; }
.ca-valtext { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.ca-masked { color: var(--muted); letter-spacing: 1px; }
.ca-valbtns { flex: none; white-space: nowrap; }
/* 徽章：底色取语义色的低透明度，文字与前景色混合 → 亮/暗两种模式都可读 */
.ca-badge { display: inline-block; padding: 1px 7px; border-radius: 10px; font-size: 11px; margin-right: 6px; }
.ca-badge.ok { background: color-mix(in oklab, var(--success) 20%, transparent); color: color-mix(in oklab, var(--success) 62%, var(--foreground)); }
.ca-badge.warn { background: color-mix(in oklab, var(--warning) 24%, transparent); color: color-mix(in oklab, var(--warning) 60%, var(--foreground)); }
.ca-badge.bad { background: color-mix(in oklab, var(--danger) 18%, transparent); color: color-mix(in oklab, var(--danger) 70%, var(--foreground)); }
.ca-badge.gray { background: color-mix(in oklab, var(--muted) 18%, transparent); color: var(--muted); }
.ca-btn { padding: 6px 12px; border: 1px solid var(--border); border-radius: 7px; background: var(--default); color: inherit; cursor: pointer; font-size: 13px; }
.ca-btn:hover { background: var(--surface-tertiary); }
.ca-btn:active:not(:disabled) { transform: translateY(1px); }
.ca-btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-foreground); }
.ca-btn.primary:hover { background: color-mix(in oklab, var(--accent) 85%, black); }
.ca-btn.ghost { border: none; background: transparent; color: var(--accent); padding: 3px 7px; border-radius: 6px; }
.ca-btn.ghost:hover { background: color-mix(in oklab, var(--accent) 8%, transparent); }
.ca-btn.ghost.danger { color: var(--danger); }
.ca-btn.ghost.danger:hover { background: color-mix(in oklab, var(--danger) 8%, transparent); }
.ca-btn.mini { padding: 2px 8px; font-size: 12px; border-radius: 6px; margin-left: 4px; }
.ca-time { color: var(--muted); font-size: 12px; white-space: nowrap; }
.ca-rowbtns { white-space: nowrap; }
.ca-import { width: 100%; min-height: 110px; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; padding: 8px; border: 1px solid var(--border); border-radius: 8px; resize: vertical; background: var(--field-background); color: var(--field-foreground); }
.ca-opts { display: flex; gap: 18px; align-items: center; margin: 10px 0 4px; flex-wrap: wrap; }
.ca-radio { display: flex; gap: 5px; align-items: center; cursor: pointer; font-size: 13px; }
.ca-toast { position: fixed; top: 16px; right: 16px; padding: 10px 16px; border-radius: 8px; font-size: 13px; z-index: 99; max-width: 420px; word-break: break-all; }
.ca-toast.ok { background: var(--success); color: var(--success-foreground); }
.ca-toast.err { background: var(--danger); color: var(--danger-foreground); }
.ca-empty { color: var(--muted); }
.ca-addform { display: grid; grid-template-columns: 1fr 2fr 1fr 80px 1fr auto; gap: 8px; align-items: center; margin-top: 10px; }
.ca-addform input { padding: 5px 8px; border: 1px solid var(--border); border-radius: 6px; font-size: 13px; background: var(--field-background); color: var(--field-foreground); }
.ca-edit { margin-top: 12px; }
.ca-editgrid { display: grid; grid-template-columns: 90px 1fr; gap: 8px 10px; align-items: center; }
.ca-editgrid .lbl { color: var(--muted); font-size: 12px; }
.ca-editgrid input[type=text], .ca-editgrid textarea { padding: 5px 8px; border: 1px solid var(--border); border-radius: 6px; font-size: 13px; font-family: inherit; width: 100%; background: var(--field-background); color: var(--field-foreground); }
.ca-editgrid textarea { min-height: 60px; font-family: ui-monospace, Menlo, Consolas, monospace; resize: vertical; }
.ca-editgrid input[type=datetime-local] { padding: 5px 8px; border: 1px solid var(--border); border-radius: 6px; font-size: 13px; background: var(--field-background); color: var(--field-foreground); }
.ca-editbtns { margin-top: 10px; display: flex; gap: 8px; }
.ca-tab:focus-visible, .ca-btn:focus-visible, .ca-addform input:focus-visible, .ca-editgrid input:focus-visible, .ca-editgrid textarea:focus-visible, .ca-import:focus-visible { outline: 2px solid color-mix(in oklab, var(--accent) 55%, transparent); outline-offset: 2px; }
@media (max-width: 760px) { .ca-addform { grid-template-columns: 1fr 1fr; } }
`

/*
 * @Description: AI 四项能力（单条分析 / 生成摘要 / 每日简报 / 趋势分析）
 *
 * 2026-09-16 从 `src/app/AiModel/ai-panel.tsx` 原样搬出。四项能力仍各自持有本地 state，
 * 由调用方保证"常驻挂载"，避免切换或关闭抽屉时丢进度。
 * （下一步会把 state 提到 store，见 AiAssistant/store.ts）
 */
'use client'

import { useEffect } from 'react'

import Markdown from '@/components/Markdown'
import { RESPONSE } from '@/enums'
import { copyText } from '@/lib/clipboard'
import { SOURCES, useAiAssistantStore } from './store'

import Collapsible from './collapsible'
import HistoryList, { formatTime } from './history-list'
import { useHistory } from './use-history'

import type { AnalyzeResult, BriefingData, ItemResult, Notify, SummaryRow } from '@/lib/ai-client'

const CONTENT_SOURCE_LABEL: Record<ItemResult['contentSource'], string> = {
  provided: '你粘贴的正文',
  fetched: '已抓取网页正文',
  'title-only': '仅标题',
}


export function ItemTab({ disabled, notify }: { disabled: boolean, notify: Notify }) {
  // 状态放在模块级 store（抽屉关闭会卸载组件，本地 state 会丢）
  const { title, url, content, loading, data } = useAiAssistantStore(s => s.item)
  const patchItem = useAiAssistantStore(s => s.patchItem)
  const run = useAiAssistantStore(s => s.runItem)
  const tick = useAiAssistantStore(s => s.historyTick.item)
  const setTitle = (v: string) => patchItem({ title: v })
  const setUrl = (v: string) => patchItem({ url: v })
  const setContent = (v: string) => patchItem({ content: v })
  const setData = (v: ItemResult | null) => patchItem({ data: v })

  const { entries: history, reload: reloadHistory, remove: removeHistory, clear: clearHistory } = useHistory('item')

  // 生成成功后（store 的 tick 变化）刷新历史列表
  useEffect(() => { if (tick) void reloadHistory() }, [tick, reloadHistory])



  return (
    <div className="ai-card">
      <h2>单条分析</h2>
      <div className="ai-srcinfo">
        分析单独一条信息。填了链接会尝试抓取网页正文再分析；抓不到（登录墙、反爬、纯前端渲染）就只依据标题，结果里会注明实际依据。
        也可以在热榜标题上<b>右键 → 分析此条</b>直接打开首页右下角的 AI 助手。
      </div>

      <div className="ai-form">
        <label className="ai-field">
          标题
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="例如：某帖子的标题"
          />
        </label>
        <label className="ai-field">
          链接（可选）
          <input
            type="text"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://…"
          />
        </label>
      </div>

      <label className="ai-field ai-field-block">
        正文（可选，粘贴后优先于抓取）
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder="部分站点需要登录才能看到正文，可直接把正文粘贴到这里"
        />
      </label>

      <div className="ai-opts">
        <button type="button" className="ai-btn primary" onClick={() => run()} disabled={disabled || loading}>
          {loading ? '分析中…' : '分析这一条'}
        </button>
        {url && (
          <button type="button" className="ai-btn" onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}>
            打开链接
          </button>
        )}
      </div>

      {loading && <div className="ai-empty">正在{url && !content ? '抓取正文并' : ''}分析，首次约需数秒…</div>}

      {data && (
        <>
          <div className="ai-meta">
            {data.historyAt
              ? `历史记录 · ${formatTime(data.historyAt)}`
              : `依据：${CONTENT_SOURCE_LABEL[data.contentSource]}`}
            {!data.historyAt && data.contentLength > 0 && ` · 正文 ${data.contentLength} 字`}
            {!data.historyAt && data.cached && ' · 命中缓存'}
            {!data.historyAt && !!data.authSourceId && (
              <span className="ai-badge ok ai-badge-inline" title="已带该站点的登录态抓取正文">已带{data.authLabel || data.authSourceId}凭据</span>
            )}
            {!data.historyAt && !!data.usage?.totalTokens && ` · 消耗 ${data.usage.totalTokens.toLocaleString('en-US')} token`}
          </div>
          {data.fetchNote && <div className="ai-warn">{data.fetchNote}</div>}
          {data.pageTitle && <div className="ai-srcinfo">网页标题：{data.pageTitle}</div>}
          <Collapsible text={data.text}>
            <Markdown className="ai-out" text={data.text} />
          </Collapsible>
        </>
      )}

      <HistoryList
        entries={history}
        onRemove={removeHistory}
        onClear={clearHistory}
        onPick={(e) => {
          setData({
            text: e.text || '',
            cached: true,
            contentSource: 'title-only',
            contentLength: 0,
            fetchNote: '',
            pageTitle: '',
            historyAt: e.at,
          })
          notify('已载入历史记录')
        }}
      />
    </div>
  )
}


export function SummaryTab({ disabled, notify }: { disabled: boolean, notify: Notify }) {
  // 状态放在模块级 store（抽屉关闭会卸载组件，本地 state 会丢）
  const { alias, limit, loading, rows } = useAiAssistantStore(s => s.summary)
  const patchSummary = useAiAssistantStore(s => s.patchSummary)
  const run = useAiAssistantStore(s => s.runSummary)
  const tick = useAiAssistantStore(s => s.historyTick.summary)
  const setAlias = (v: string) => patchSummary({ alias: v })
  const setLimit = (v: number) => patchSummary({ limit: v })
  const setRows = (v: SummaryRow[]) => patchSummary({ rows: v })

  const { entries: history, reload: reloadHistory, remove: removeHistory, clear: clearHistory } = useHistory('summary')

  // 生成成功后（store 的 tick 变化）刷新历史列表
  useEffect(() => { if (tick) void reloadHistory() }, [tick, reloadHistory])



  return (
    <div className="ai-card">
      <h2>逐条摘要</h2>
      <div className="ai-srcinfo">选择一个数据源，取其前若干条生成 1-2 句中文摘要。</div>
      <div className="ai-opts">
        <label className="ai-field">
          数据源
          <select value={alias} onChange={e => setAlias(e.target.value)}>
            {SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <label className="ai-field">
          条数
          <input type="number" min={1} max={30} value={limit} onChange={e => setLimit(Number(e.target.value) || 10)} />
        </label>
        <button type="button" className="ai-btn primary" onClick={run} disabled={disabled || loading}>
          {loading ? '生成中…' : '生成摘要'}
        </button>
      </div>

      {loading && <div className="ai-empty">正在调用模型，首次生成约需数秒…</div>}
      <HistoryList
        entries={history}
        onRemove={removeHistory}
        onClear={clearHistory}
        onPick={(e) => {
          setRows((e.rows || []).map(r => ({ ...r, cached: true })))
          notify('已载入历史记录')
        }}
      />

      {!loading && rows.length > 0 && (
        <>
          <div className="ai-meta">
            {rows.filter(r => r.summary).length} / {rows.length} 条
            {rows.some(r => r.cached) && ' · 含缓存'}
          </div>
          <table className="ai-table">
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.url || row.title}-${index}`}>
                <td className="ai-idx">{index + 1}</td>
                <td>
                  <div className="ai-title">
                    {row.url ? <a href={row.url} target="_blank" rel="noreferrer">{row.title}</a> : row.title}
                    {row.cached && <span className="ai-badge gray ai-badge-inline">缓存</span>}
                  </div>
                  {row.error
                    ? <div className="ai-err">生成失败：{row.error}</div>
                    : <div className="ai-summary">{row.summary}</div>}
                </td>
              </tr>
            ))}
          </tbody>
          </table>
        </>
      )}
    </div>
  )
}


export function BriefingTab({ disabled, notify }: { disabled: boolean, notify: Notify }) {
  // 状态放在模块级 store（抽屉关闭会卸载组件，本地 state 会丢）
  const { selected, perSource, loading, data } = useAiAssistantStore(s => s.briefing)
  const patchBriefing = useAiAssistantStore(s => s.patchBriefing)
  const run = useAiAssistantStore(s => s.runBriefing)
  const tick = useAiAssistantStore(s => s.historyTick.briefing)
  // JSX 里两种用法都有：直接传 Set，或传 prev => new Set(...)
  const setSelected = (v: Set<string> | ((prev: Set<string>) => Set<string>)) =>
    patchBriefing({ selected: typeof v === 'function' ? v(selected) : v })
  const setPerSource = (v: number) => patchBriefing({ perSource: v })
  const setData = (v: BriefingData | null) => patchBriefing({ data: v })

  const { entries: history, reload: reloadHistory, remove: removeHistory, clear: clearHistory } = useHistory('briefing')

  // 生成成功后（store 的 tick 变化）刷新历史列表
  useEffect(() => { if (tick) void reloadHistory() }, [tick, reloadHistory])


  const toggle = (value: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(value))
        next.delete(value)
      else
        next.add(value)
      return next
    })
  }




  const copy = async () => {
    if (!data?.text)
      return
    const ok = await copyText(data.text)
    notify(ok ? '已复制到剪贴板' : '复制失败，请手动选择文本后复制', ok)
  }

  return (
    <div className="ai-card">
      <h2>每日简报</h2>
      <div className="ai-srcinfo">
        并发抓取所选数据源，交给模型综述为「今日焦点 / 分领域动态 / 值得注意」三段。
        源越多耗时越长，建议 10-20 个源。
      </div>

      <div className="ai-opts">
        <button type="button" className="ai-btn" onClick={() => setSelected(new Set(SOURCES.map(s => s.value)))}>全选</button>
        <button type="button" className="ai-btn" onClick={() => setSelected(new Set())}>全不选</button>
        <span className="ai-picked">已选 {selected.size} / {SOURCES.length} 个源</span>
        <label className="ai-field">
          每源条数
          <input type="number" min={3} max={20} value={perSource} onChange={e => setPerSource(Number(e.target.value) || 8)} />
        </label>
        <button type="button" className="ai-btn primary" onClick={run} disabled={disabled || loading || !selected.size}>
          {loading ? '生成中…' : '生成简报'}
        </button>
      </div>

      <div className="ai-chips">
        {SOURCES.map(s => (
          <button
            key={s.value}
            type="button"
            className={`ai-chip ${selected.has(s.value) ? 'on' : ''}`}
            title={s.tip}
            onClick={() => toggle(s.value)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {loading && <div className="ai-empty">正在抓取各源并生成简报，视源数量可能需要 10-60 秒…</div>}

      {data && (
        <>
          <div className="ai-meta">
            {data.historyAt
              ? `历史记录 · ${formatTime(data.historyAt)}`
              : `依据 ${data.usedSources} 个源 / ${data.usedItems} 条 · 耗时 ${(data.elapsedMs / 1000).toFixed(1)}s`}
            {!data.historyAt && data.cached && ' · 命中缓存'}
            {!data.historyAt && !!data.usage?.totalTokens && ` · 消耗 ${data.usage.totalTokens.toLocaleString('en-US')} token`}
            <button type="button" className="ai-btn mini" onClick={copy}>复制</button>
          </div>
          {!data.historyAt && data.skipped.length > 0 && <div className="ai-srcinfo">空源已跳过：{data.skipped.join('、')}</div>}
          <Collapsible text={data.text}>
            <Markdown className="ai-out" text={data.text} />
          </Collapsible>
        </>
      )}

      <HistoryList
        entries={history}
        onRemove={removeHistory}
        onClear={clearHistory}
        onPick={(e) => {
          setData({ text: e.text || '', cached: true, usedSources: 0, usedItems: 0, elapsedMs: 0, sources: [], skipped: [], historyAt: e.at })
          notify('已载入历史记录')
        }}
      />
    </div>
  )
}


export function AnalyzeTab({ disabled, notify }: { disabled: boolean, notify: Notify }) {
  // 状态放在模块级 store（抽屉关闭会卸载组件，本地 state 会丢）
  const { alias, focus, limit, loading, data } = useAiAssistantStore(s => s.analyze)
  const patchAnalyze = useAiAssistantStore(s => s.patchAnalyze)
  const run = useAiAssistantStore(s => s.runAnalyze)
  const tick = useAiAssistantStore(s => s.historyTick.analyze)
  const setAlias = (v: string) => patchAnalyze({ alias: v })
  const setFocus = (v: string) => patchAnalyze({ focus: v })
  const setLimit = (v: number) => patchAnalyze({ limit: v })
  const setData = (v: AnalyzeResult | null) => patchAnalyze({ data: v })

  const { entries: history, reload: reloadHistory, remove: removeHistory, clear: clearHistory } = useHistory('analyze')

  // 生成成功后（store 的 tick 变化）刷新历史列表
  useEffect(() => { if (tick) void reloadHistory() }, [tick, reloadHistory])



  return (
    <div className="ai-card">
      <h2>趋势分析</h2>
      <div className="ai-srcinfo">针对单个源分析主题分布、值得关注的条目，以及疑似广告/灌水等噪声。</div>
      <div className="ai-opts">
        <label className="ai-field">
          数据源
          <select value={alias} onChange={e => setAlias(e.target.value)}>
            {SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <label className="ai-field">
          条数
          <input type="number" min={5} max={50} value={limit} onChange={e => setLimit(Number(e.target.value) || 20)} />
        </label>
        <label className="ai-field wide">
          特别关注（可选）
          <input type="text" value={focus} onChange={e => setFocus(e.target.value)} placeholder="如：与 AI 相关的动向" />
        </label>
        <button type="button" className="ai-btn primary" onClick={run} disabled={disabled || loading}>
          {loading ? '分析中…' : '生成分析'}
        </button>
      </div>

      {loading && <div className="ai-empty">正在分析…</div>}
      {data && (
        <>
          <div className="ai-meta">
            {data.historyAt
              ? `历史记录 · ${formatTime(data.historyAt)} · ${data.label}`
              : `${data.label} · ${data.usedItems} 条${data.cached ? ' · 命中缓存' : ''}${data.usage?.totalTokens ? ` · 消耗 ${data.usage.totalTokens.toLocaleString('en-US')} token` : ''}`}
          </div>
          <Collapsible text={data.text}>
            <Markdown className="ai-out" text={data.text} />
          </Collapsible>
        </>
      )}

      <HistoryList
        entries={history}
        onRemove={removeHistory}
        onClear={clearHistory}
        onPick={(e) => {
          setData({ text: e.text || '', cached: true, usedItems: 0, label: e.label, historyAt: e.at })
          notify('已载入历史记录')
        }}
      />
    </div>
  )
}

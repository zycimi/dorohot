/*
 * @Description: 模型设置（供应商库 / Base URL / API 类型 / API Key / 对话模型 / Headers / 读取模型 / 测试连接）
 *
 * 2026-09-16 从 `src/app/AiModel/ai-panel.tsx` 的 SettingsTab 原样搬出，供 `/settings` 页使用。
 */
'use client'

import { CloudCheck, Pencil, TrashBin } from '@gravity-ui/icons'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { post } from '@/lib/ai-client'

import type { AiConfig, ApiTypeOption, ModelsResult, Notify, SettingKey, TestResult } from '@/lib/ai-client'

const NAME_PRESETS = ['DeepSeek']
const MODEL_MODES_FALLBACK = [
  { value: 'text', label: '文本' },
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
]
const FALLBACK_API_TYPES: ApiTypeOption[] = [
  { value: 'chat-completions', label: 'Chat Completions', path: '/chat/completions', hint: 'OpenAI 兼容（DeepSeek / 通义 / Kimi / 智谱 / vLLM 等）' },
  { value: 'anthropic-messages', label: 'Anthropic Messages', path: '/v1/messages', hint: 'Claude 原生协议（x-api-key 鉴权）' },
  { value: 'responses', label: 'Responses', path: '/responses', hint: 'OpenAI Responses API' },
]

export function ModelSettings({ config, notify, onSaved }: { config: AiConfig | null, notify: Notify, onSaved: () => void }) {  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [headers, setHeaders] = useState('')
  const [apiType, setApiType] = useState('chat-completions')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [modelModes, setModelModes] = useState<string[]>(['text'])
  const [editingModel, setEditingModel] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [fetchingModels, setFetchingModels] = useState(false)
  const [deletingProvider, setDeletingProvider] = useState(false)
  const [modelOptions, setModelOptions] = useState<string[]>([])
  const [modelHint, setModelHint] = useState('')
  const [testResult, setTestResult] = useState<{ ok: boolean, detail: string } | null>(null)
  /** 表单初始快照，用于「有未保存的修改」提示 */
  const initialForm = useRef('')

  // 配置载入后回填（API Key 留空表示不修改）
  useEffect(() => {
    if (!config)
      return
    setName(config.name)
    setBaseUrl(config.baseUrl)
    setHeaders(config.headers)
    setApiType(config.apiType)
    setModel(config.model)
    setModelModes(config.modelModes?.length ? config.modelModes : ['text'])
    setApiKey('')
    setEditingModel(false)
    setTestResult(null)
    initialForm.current = JSON.stringify({
      name: config.name,
      baseUrl: config.baseUrl,
      headers: config.headers,
      apiType: config.apiType,
      apiKey: '',
      model: config.model,
      modelModes: config.modelModes?.length ? config.modelModes : ['text'],
    })
  }, [config])

  const save = async () => {
    setSaving(true)
    try {
      await post<AiConfig>('/api/ai/config', { name, baseUrl, headers, apiType, apiKey, model, modelModes })
      setTestResult(null)
      notify('已保存')
      onSaved()
    }
    catch (e) {
      notify((e as Error).message, false)
    }
    finally {
      setSaving(false)
    }
  }

  const test = async () => {
    setTesting(true)
    try {
      const result = await post<TestResult>('/api/ai/config/test')
      setTestResult({ ok: true, detail: `${result.model} · ${result.elapsedMs}ms · ${result.reply}` })
      notify(`连接正常（${result.model}，${result.elapsedMs}ms）：${result.reply}`)
    }
    catch (e) {
      setTestResult({ ok: false, detail: (e as Error).message })
      notify((e as Error).message, false)
    }
    finally {
      setTesting(false)
    }
  }

  // 下拉的关闭兜底：点击下拉与输入框之外的任何位置、或按 Esc 都收起
  // （只靠输入框 onBlur 不够：某些点击目标不会让输入框失焦）
  useEffect(() => {
    if (!pickerOpen)
      return
    const onDocMouseDown = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node))
        setPickerOpen(false)
    }
    const onDocKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape')
        setPickerOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onDocKeyDown)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onDocKeyDown)
    }
  }, [pickerOpen])

  // 选中已有供应商 → 切换为当前使用，并把表单回填成它的设置
  const switchProvider = async (target: string) => {
    try {
      const data = await post<AiConfig>('/api/ai/config/activate', { name: target })
      setName(data.name)
      setBaseUrl(data.baseUrl)
      setHeaders(data.headers)
      setApiType(data.apiType)
      setModel(data.model)
      setModelModes(data.modelModes?.length ? data.modelModes : ['text'])
      setApiKey('') // 留空 = 沿用该供应商已存的 Key
      setEditingModel(false)
      setTestResult(null)
      notify(`已切换到「${target}」`)
      onSaved()
    }
    catch (e) {
      notify((e as Error).message, false)
    }
  }

  // 名字改成已有供应商时自动切换；输入新名字则视为待保存的新供应商
  const handleNameChange = (value: string) => {
    setName(value)
    const hit = config?.providers.find(p => p.name === value)
    if (hit && value !== config?.active)
      void switchProvider(value)
  }

  // 添加供应商：清空表单（API 类型按用户要求保留）
  const addProvider = () => {
    setName('')
    setBaseUrl('')
    setHeaders('')
    setApiKey('')
    setModel('')
    setModelModes(['text'])
    setEditingModel(false)
    setPickerOpen(false)
    notify('已重置为空白，填好后点「保存供应商」')
  }

  // 清除当前模型（连带模式复位）
  const removeModel = () => {
    setModel('')
    setModelModes(['text'])
    setEditingModel(false)
    notify('已清除当前模型，点「保存供应商」生效')
  }

  // 删除供应商：从配置文件移除（不可恢复）。删除的是当前供应商时，服务端会自动切到剩下的第一份。
  const removeProvider = async () => {
    const target = name.trim()
    if (!target)
      return
    if (!window.confirm(`确定删除供应商「${target}」？会从配置文件移除，且不可恢复。`))
      return
    setDeletingProvider(true)
    try {
      const res = await fetch(`/api/ai/config?name=${encodeURIComponent(target)}`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        notify(json?.msg || '删除失败', false)
        return
      }
      notify(`已删除供应商「${target}」`)
      onSaved()
    }
    catch {
      notify('网络错误，请重试', false)
    }
    finally {
      setDeletingProvider(false)
    }
  }

  // 拉取当前 API Key 可用的模型（用表单里尚未保存的值，方便填完 Key 先试）
  const fetchModels = async () => {
    setFetchingModels(true)
    setModelHint('')
    try {
      const data = await post<ModelsResult>('/api/ai/models', { baseUrl, headers, apiType, apiKey })
      setModelOptions(data.models || [])
      setModelHint(`拉到 ${data.models.length} 个模型 · ${data.endpoint}`)
      notify(`拉到 ${data.models.length} 个模型，可在「对话模型」里选择`)
    }
    catch (e) {
      setModelHint('')
      notify((e as Error).message, false)
    }
    finally {
      setFetchingModels(false)
    }
  }

  // 字段下方只保留「被环境变量锁定」这类需要留意的警告（来源信息已按用户要求从界面移除）
  const sourceHint = (key: SettingKey) => {
    if (!config?.envLocked[key])
      return null
    return <span className="ai-hint">已被环境变量锁定，此处修改不会生效</span>
  }

  const typeOptions = config?.apiTypes?.length ? config.apiTypes : FALLBACK_API_TYPES
  const currentType = typeOptions.find(t => t.value === apiType)

  // 已保存了 Key，或表单里刚填了 Key，都可以直接发起请求（无需先保存）
  const canCall = !!apiKey.trim() || !!config?.hasApiKey

  // 只有「表单里的名字是已保存的供应商」时才可删除
  const canDeleteProvider = !!config?.providers?.some(p => p.name === name.trim())

  // 与初始快照对比，提示「有未保存的修改」
  const dirty = !!initialForm.current
    && JSON.stringify({ name, baseUrl, headers, apiType, apiKey, model, modelModes }) !== initialForm.current

  const modeOptions = config?.modelModeOptions?.length ? config.modelModeOptions : MODEL_MODES_FALLBACK
  const modeLabel = modelModes
    .map(value => modeOptions.find(m => m.value === value)?.label || value)
    .join('/')

  // 模式多选切换（至少保留一项）
  const toggleMode = (value: string) => {
    setModelModes(prev => prev.includes(value)
      ? (prev.length > 1 ? prev.filter(v => v !== value) : prev)
      : [...prev, value])
  }

  // 端点预览（规则与服务端 apiEndpoint 一致，保存后以服务端返回为准）
  const previewEndpoint = (() => {
    const base = (baseUrl || '').trim().replace(/\/+$/, '')
    const path = currentType?.path || '/chat/completions'
    if (!base)
      return path
    if (base.toLowerCase().endsWith(path.toLowerCase()))
      return base
    if (path.startsWith('/v1/') && base.toLowerCase().endsWith('/v1'))
      return base + path.slice(3)
    return base + path
  })()

  return (
    <div className="ai-card model-settings">
      <div className="ms-head">
        <h2>模型设置</h2>
        {dirty && <span className="ms-dirty">有未保存的修改</span>}
      </div>
      <div className="ai-srcinfo">
        七项均可自由填写，支持各类兼容网关。API 类型决定端点路径与鉴权方式，保存后建议点一次「测试连接」验证。
      </div>

      {/* 两行共用一个 grid（而非两个），列宽完全一致 → Base URL 与对话模型的输入框左边缘与宽度都严格对齐 */}
      <div className="ms-sec">连接</div>
      <div className="ai-grid">
        <div className="ai-field">
          <label htmlFor="ai-name">供应商名字</label>
          {/* 用自绘下拉而非原生 datalist：原生下拉宽度由浏览器决定、会超出表单，这里限制为字段宽度并省略超长名字 */}
          <div ref={pickerRef} className="ai-picker-wrap">
            <input
              id="ai-name"
              type="text"
              value={name}
              onChange={e => handleNameChange(e.target.value)}
              onFocus={() => setPickerOpen(true)}
              onBlur={() => setPickerOpen(false)}
              onKeyDown={e => { if (e.key === 'Escape') setPickerOpen(false) }}
              placeholder="选已有供应商，或输入新名字"
            />
            {pickerOpen && (config?.providers?.length ?? 0) > 0 && (
              <div className="ai-picker">
                {(config?.providers ?? []).map(item => (
                  <button
                    key={item.name}
                    type="button"
                    className={`ai-picker-item ${item.name === config?.active ? 'on' : ''}`}
                    title={item.name}
                    // 阻止默认行为以保持输入框焦点，避免 blur 先把下拉关掉
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => {
                      setPickerOpen(false)
                      if (item.name !== config?.active)
                        void switchProvider(item.name)
                    }}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          {sourceHint('name')}
        </div>

        <div className="ai-field">
          <label htmlFor="ai-baseurl">Base URL</label>
          <input
            id="ai-baseurl"
            type="text"
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
            placeholder={config?.defaults.baseUrl ?? 'https://api.deepseek.com'}
          />
          {sourceHint('baseUrl')}
        </div>

        <div className="ai-field">
          <label htmlFor="ai-apitype">API 类型</label>
          <select id="ai-apitype" value={apiType} onChange={e => setApiType(e.target.value)}>
            {typeOptions.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          {sourceHint('apiType')}
        </div>

      </div>

      <div className="ms-sec">鉴权与模型</div>
      <div className="ai-grid">
        <div className="ai-field">
          <label htmlFor="ai-apikey">API Key</label>
          <input
            id="ai-apikey"
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder={config?.hasApiKey ? `${config.apiKeyMasked}(留空则不修改)` : 'sk-…'}
            autoComplete="off"
          />
          {sourceHint('apiKey')}
        </div>

        <div className="ai-field">
          <label htmlFor="ai-model">对话模型</label>
          {/* 输入框只占 Base URL 那一列，右边缘与 Base URL 严格对齐 */}
          <input
            id="ai-model"
            type="text"
            list="ai-model-options"
            value={model}
            onChange={e => setModel(e.target.value)}
            placeholder="添加模型"
          />
          <datalist id="ai-model-options">
            {modelOptions.map(item => <option key={item} value={item} />)}
          </datalist>
          {modelHint
            ? <span className="ai-hint">{modelHint}</span>
            : model
              ? (
                  <span className="ai-hint ms-model-meta">
                    <span>当前：{model}</span>
                    <span>模式：{modeLabel}</span>
                  </span>
                )
              : <span className="ai-hint">尚未添加模型</span>}
        </div>

        {/* 按钮单独占第 3 列：既在输入框右侧，又不会挤短输入框（否则右边缘无法与 Base URL 对齐） */}
        <div className="ai-field ai-model-actions">
          <span aria-hidden="true">&nbsp;</span>
          <div className="ai-btnrow">
            <button
              type="button"
              className="ai-icon-btn"
              onClick={test}
              disabled={testing || !canCall}
              title={testing ? '正在测试连接…' : '测试连接（用当前配置发一次最小请求）'}
              aria-label="测试连接"
            >
              <CloudCheck width={14} height={14} />
            </button>
            <button
              type="button"
              className={`ai-icon-btn ${editingModel ? 'on' : ''}`}
              onClick={() => setEditingModel(v => !v)}
              title={editingModel ? '完成编辑' : '编辑当前模型（模式可多选）'}
              aria-label="编辑模型"
            >
              <Pencil width={14} height={14} />
            </button>
            <button
              type="button"
              className="ai-icon-btn danger"
              onClick={removeModel}
              disabled={!model && modelModes.length <= 1 && modelModes[0] === 'text'}
              title="清除当前模型"
              aria-label="删除模型"
            >
              <TrashBin width={14} height={14} />
            </button>
            <button
              type="button"
              className="ai-btn mini"
              onClick={fetchModels}
              disabled={fetchingModels || !canCall}
              title="用当前 Base URL / API Key 读取可用模型"
            >
              {fetchingModels ? '读取中…' : '读取模型'}
            </button>
          </div>
        </div>

        {editingModel && (
          <div className="ai-field ai-grid-all">
            <div className="ai-editbox">
              <span className="ai-editbox-label">模式（可多选）</span>
              {modeOptions.map(item => (
                <label key={item.value} className="ai-check">
                  <input
                    type="checkbox"
                    checked={modelModes.includes(item.value)}
                    onChange={() => toggleMode(item.value)}
                  />
                  {item.label}
                </label>
              ))}
              <span className="ai-hint">当前 AI 各项能力都按文本处理，图片/视频暂只作标记</span>
            </div>
          </div>
        )}
      </div>



      {/* 与上方同一套栅格、固定在第 2 列：右边缘即与 Base URL 对齐 */}
      <div className="ms-sec">请求头（可选）</div>
      <div className="ai-grid">
        <label className="ai-field ai-grid-col1-2">
          Headers
          <textarea
            className="ai-headers"
            value={headers}
            onChange={e => setHeaders(e.target.value)}
            placeholder={'JSON 对象或每行 Key: Value，两种都支持：\n{\n  "X-Custom-Header": "value"\n}'}
          />
          {sourceHint('headers')}
        </label>
      </div>

      <div className="ai-endpoint">
        实际请求端点：<code>{previewEndpoint}</code>
        {apiType === 'anthropic-messages' && <span className="ai-hint"> · 用 x-api-key 鉴权，自动附带 anthropic-version</span>}
        {apiType === 'responses' && <span className="ai-hint"> · 系统提示走 instructions，上限字段为 max_output_tokens</span>}
      </div>

      {testResult && (
        <div className="ms-test">
          <span className={`ai-badge ${testResult.ok ? 'ok' : 'bad'}`}>{testResult.ok ? '连接正常' : '连接失败'}</span>
          <span className="ms-test-detail">{testResult.detail}</span>
        </div>
      )}

      <div className="ai-opts">
        <button type="button" className="ai-btn" onClick={addProvider} title="清空表单，配置一个新供应商（API 类型保留）">
          添加供应商
        </button>
        <button
          type="button"
          className="ai-btn danger"
          onClick={() => void removeProvider()}
          disabled={deletingProvider || !canDeleteProvider}
          title={canDeleteProvider ? `从配置文件中删除供应商「${name}」` : '当前不是已保存的供应商，无法删除'}
        >
          {deletingProvider ? '删除中…' : '删除供应商'}
        </button>
        <button
          type="button"
          className="ai-btn"
          onClick={() => {
            setName(config?.defaults.name ?? 'DeepSeek')
            setBaseUrl(config?.defaults.baseUrl ?? '')
            setModel(config?.defaults.model ?? '')
            setModelModes(['text'])
            setApiType('chat-completions')
          }}
        >
          恢复默认值
        </button>
        <button type="button" className="ai-btn primary" onClick={save} disabled={saving}>
          {saving ? '保存中…' : '保存供应商'}
        </button>
      </div>

      {config && (
        <section className="ms-status">
          <div className="ms-status-head">
            <span className="ms-status-title">当前生效</span>
            <span className={`ai-badge ${config.configured ? 'ok' : 'bad'}`}>{config.configured ? '已配置' : '未配置'}</span>
          </div>
          <div className="ai-kv">
          <div className="ai-kv-row"><span>供应商名字</span><code>{config.name}</code></div>
          <div className="ai-kv-row"><span>对话模型</span><code>{config.model || '（未设置）'}</code></div>
          <div className="ai-kv-row"><span>模型模式</span><code>{modeLabel}</code></div>
          <div className="ai-kv-row"><span>生效端点</span><code>{config.endpoint}</code></div>
          <div className="ai-kv-row"><span>API 类型</span><code>{config.apiType}</code></div>
          <div className="ai-kv-row"><span>自定义头</span><code>{config.headerCount ? `${config.headerCount} 条` : '无'}</code></div>
          <div className="ai-kv-row">
            <span>配置文件</span>
            <code>{config.configFile}</code>
            {!config.configFileExists && ' （尚未创建，保存后生成）'}
            {config.usingLegacyConfigFile && ` （旧文件名，保存后迁移到 ${config.configFileTarget?.split('/').pop() ?? 'model-config.json'}）`}
          </div>
          <div className="ai-kv-row"><span>结果缓存</span><code>{config.cacheDir}</code></div>
          </div>
        </section>
      )}

      <div className="ai-srcinfo" style={{ marginTop: 10 }}>
        保存前会自动备份为 <code>.bak</code>；Key 只写入服务端文件，接口返回的始终是掩码。
      </div>
    </div>
  )
}

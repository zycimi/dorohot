/*
 * @Description: AI 助手「AI对话」标签页（多会话 + 历史对话列表视图 + 可编辑 + 可复制）
 *
 * 交互（2026-09-17 重构历史对话）：
 *  - 普通聊天：流式输出，边生成边显示；
 *  - 热榜右键「分析此条」：把标题/链接作为 context 附着到当前会话（刻意不新建，便于标题与内容串联）；
 *  - 历史对话：底部按钮进入独立**列表视图**（返回 / 新建 / 搜索 / 分组列表 / 分页）；
 *    点整行 = 打开该对话；每行「⋮」展开「置顶 / 重命名 / 删除」；
 *    删除后底部出现「撤销」条（6 秒内可恢复）；
 *  - 重命名：弹窗输入，可点「自动命名」让模型起标题；
 *  - 编辑：user 消息气泡右下角铅笔图标；编辑态显示「待确认」，图标化「取消 / 确认」；
 *  - 复制：AI 回复气泡内左下「消耗 token」/ 右下「复制」；用户消息的「编辑 + 复制」在气泡**外**右下角。
 */
'use client'

import { ArrowChevronDown, ArrowChevronLeft, ArrowRotateLeft, ArrowsRotateRight, Check, Copy, EllipsisVertical, ListUl, Magnifier, Pencil, PinFill, Plus, Xmark } from '@gravity-ui/icons'
import { Fragment, useEffect, useRef, useState } from 'react'

import Markdown from '@/components/Markdown'

import { copyText } from '@/lib/clipboard'

import { useAiAssistantStore } from './store'

import type { ChatSession, Notify } from '@/lib/ai-client'

const SUGGESTIONS = [
  '用一句话解释今天的微博热搜里最值得关注的事',
  '帮我把上面这条内容整理成 3 条要点',
  '这件事可能有什么后续影响？',
  '/订阅 每天早上9点把热榜发到 me@qq.com',
]

const PAGE_SIZE = 20

function formatHistoryTime(at: number) {
  if (!at)
    return ''
  return new Date(at).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatClock(at: number) {
  if (!at)
    return ''
  return new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

export function ChatTab({ disabled, notify, webSearchAvailable = false }: { disabled: boolean, notify: Notify, webSearchAvailable?: boolean }) {
  const { sessions, activeId, previousActiveId, messages, input, loading, context, contextUsed, error, pendingSubscription, webSearch } = useAiAssistantStore(s => s.chat)
  const patchChat = useAiAssistantStore(s => s.patchChat)
  const setWebSearch = useAiAssistantStore(s => s.setWebSearch)
  const sendChat = useAiAssistantStore(s => s.sendChat)
  const retryChat = useAiAssistantStore(s => s.retryChat)
  const applyChatSubscription = useAiAssistantStore(s => s.applyChatSubscription)
  const cancelChatSubscription = useAiAssistantStore(s => s.cancelChatSubscription)
  const editChatMessage = useAiAssistantStore(s => s.editChatMessage)
  const newChat = useAiAssistantStore(s => s.newChat)
  const selectChat = useAiAssistantStore(s => s.selectChat)
  const deleteChat = useAiAssistantStore(s => s.deleteChat)
  const reinsertChatSession = useAiAssistantStore(s => s.reinsertChatSession)
  const restoreLastChat = useAiAssistantStore(s => s.restoreLastChat)
  const renameChat = useAiAssistantStore(s => s.renameChat)
  const togglePinChat = useAiAssistantStore(s => s.togglePinChat)
  const ensureChatLoaded = useAiAssistantStore(s => s.ensureChatLoaded)
  const listRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const editTextareaRef = useRef<HTMLTextAreaElement>(null)
  const stickRef = useRef(true)
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [historyView, setHistoryView] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const [query, setQuery] = useState('')
  const [actionsId, setActionsId] = useState<string | null>(null)
  const [renameTarget, setRenameTarget] = useState<string | null>(null)
  const [renamingText, setRenamingText] = useState('')
  const [autoBusy, setAutoBusy] = useState(false)
  const [undo, setUndo] = useState<{ session: ChatSession, wasActive: boolean } | null>(null)
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE)
  const [atBottom, setAtBottom] = useState(true)

  const lastContentLength = messages[messages.length - 1]?.content.length ?? 0
  const streamingId = loading ? messages[messages.length - 1]?.id : undefined

  // 切换会话时回到最新位置
  useEffect(() => {
    stickRef.current = true
    setAtBottom(true)
  }, [activeId])

  // 只在「贴近底部」时自动跟随，用户往上翻历史时不会被新内容强行拉回
  useEffect(() => {
    const el = listRef.current
    if (el && stickRef.current)
      el.scrollTop = el.scrollHeight
  }, [messages.length, lastContentLength, loading])

  // 新消息输入框保持紧凑，为对话记录留出更多纵向空间；长内容仍可在框内滚动。
  useEffect(() => {
    const el = composerRef.current
    if (!el)
      return
    const resize = () => {
      const mobile = window.matchMedia('(max-width: 640px)').matches
      const minHeight = mobile ? 64 : 72
      const maxHeight = mobile ? 100 : 132
      el.style.height = 'auto'
      el.style.height = `${Math.min(maxHeight, Math.max(minHeight, el.scrollHeight))}px`
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [input])

  // 编辑历史消息时，把编辑器滚入聊天可视区并聚焦，长对话里也能立即开始修改。
  useEffect(() => {
    if (!editingId)
      return
    const el = editTextareaRef.current
    if (!el)
      return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' })
    el.focus({ preventScroll: true })
  }, [editingId])

  const onChatScroll = () => {
    const el = listRef.current
    if (!el)
      return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    stickRef.current = nearBottom
    setAtBottom(nearBottom)
  }

  const jumpToBottom = () => {
    const el = listRef.current
    stickRef.current = true
    setAtBottom(true)
    if (el)
      el.scrollTop = el.scrollHeight
  }

  useEffect(() => {
    setVisibleLimit(PAGE_SIZE)
  }, [query, historyView])

  useEffect(() => () => {
    if (undoTimer.current)
      clearTimeout(undoTimer.current)
  }, [])

  const send = () => {
    if (disabled || loading)
      return
    void sendChat()
  }

  const toggleWebSearch = () => {
    if (!webSearchAvailable) {
      notify('请先到「设置 → 联网搜索」启用并配置搜索源', false)
      return
    }
    setWebSearch(!webSearch)
  }

  useEffect(() => {
    if (!webSearchAvailable && webSearch)
      setWebSearch(false)
  }, [setWebSearch, webSearch, webSearchAvailable])

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      send()
    }
  }

  const copyMessage = async (text: string) => {
    const content = text.trim()
    if (!content) {
      notify('这条消息没有可复制的内容', false)
      return
    }
    try {
      const ok = await copyText(content)
      if (ok)
        notify('已复制这条消息')
      else
        notify('复制失败，请手动选择文本后复制', false)
    }
    catch {
      notify('复制失败，请手动选择文本后复制', false)
    }
  }

  const beginEdit = (id: string, content: string) => {
    setEditingId(id)
    setEditingText(content)
  }

  const submitEdit = () => {
    if (!editingId)
      return
    const id = editingId
    setEditingId(null)
    void editChatMessage(id, editingText)
  }

  // ---------------- 历史对话列表视图 ----------------
  const openHistory = () => {
    setHistoryView(true)
    setEditingId(null)
    setActionsId(null)
    setVisibleLimit(PAGE_SIZE)
  }

  const openSession = (id: string) => {
    if (loading)
      notify('已停止当前生成，切换到所选对话')
    selectChat(id)
    setHistoryView(false)
    setEditingId(null)
    setActionsId(null)
  }

  const handleNewChat = () => {
    // 已经是一个空白新会话时不再重复建，避免历史里堆一串「未命名对话」
    if (activeId && !messages.length && !input.trim()) {
      setHistoryView(false)
      notify('当前已经是新对话')
      return
    }
    newChat()
    setHistoryView(false)
    setEditingId(null)
    setActionsId(null)
    notify('已新建对话')
  }

  const openRenameDialog = (id: string, title: string) => {
    setRenameTarget(id)
    setRenamingText(title || '未命名对话')
    setAutoBusy(false)
  }

  const submitRename = () => {
    if (!renameTarget)
      return
    renameChat(renameTarget, renamingText)
    setRenameTarget(null)
  }

  const autoName = async () => {
    if (!renameTarget)
      return
    const session = await ensureChatLoaded(renameTarget)
    if (!session) {
      notify('这段对话还没有内容，无法自动命名', false)
      return
    }
    const source = [
      session.context?.title ? `热榜标题：${session.context.title}` : '',
      ...session.messages.slice(-8).map(m => `${m.role === 'user' ? '用户' : '助手'}：${m.content}`),
    ].filter(Boolean).join('\n').slice(0, 2500)
    if (!source.trim()) {
      notify('这段对话还没有内容，无法自动命名', false)
      return
    }
    setAutoBusy(true)
    try {
      const res = await fetch('/api/ai/title', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: source }),
      }).then(r => r.json()).catch(() => null)
      if (!res || res.code !== 200 || !res.data?.title)
        throw new Error(res?.msg || '自动命名失败')
      setRenamingText(res.data.title)
    }
    catch (e) {
      notify((e as Error).message, false)
    }
    finally {
      setAutoBusy(false)
    }
  }

  const handleDelete = async (session: ChatSession) => {
    const wasActive = session.id === activeId
    // 删除前拉齐完整 messages，保证「撤销删除」能原样插回
    const removed = await deleteChat(session.id)
    setActionsId(null)
    if (editingId === session.id)
      setEditingId(null)
    if (renameTarget === session.id)
      setRenameTarget(null)
    if (undoTimer.current)
      clearTimeout(undoTimer.current)
    setUndo({ session: removed ?? session, wasActive })
    undoTimer.current = setTimeout(() => {
      undoTimer.current = null
      setUndo(null)
    }, 6000)
  }

  const undoDelete = () => {
    if (!undo)
      return
    if (undoTimer.current) {
      clearTimeout(undoTimer.current)
      undoTimer.current = null
    }
    reinsertChatSession(undo.session, undo.wasActive)
    setUndo(null)
    notify('已恢复对话')
  }

  const normalizedQuery = query.trim().toLowerCase()
  // 会话可能是摘要（messages 未加载），只匹配 title / preview，命中后打开时按需加载
  const visibleSessions = normalizedQuery
    ? sessions.filter(s =>
        (s.title || '未命名对话').toLowerCase().includes(normalizedQuery)
        || (s.preview || '').toLowerCase().includes(normalizedQuery),
      )
    : sessions

  const pagedSessions = visibleSessions.slice(0, visibleLimit)
  const pinnedSessions = pagedSessions.filter(s => s.pinned)
  const normalSessions = pagedSessions.filter(s => !s.pinned)
  const hasPinned = visibleSessions.some(s => s.pinned)
  const hasMore = visibleLimit < visibleSessions.length

  const onListScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget
    if (hasMore && el.scrollTop + el.clientHeight >= el.scrollHeight - 48)
      setVisibleLimit(v => Math.min(v + PAGE_SIZE, visibleSessions.length))
  }

  const renderItem = (session: ChatSession) => {
    const isCurrent = session.id === activeId
    const showActions = actionsId === session.id
    return (
      <div key={session.id} className={`ai-chat-history-item ${isCurrent ? 'on' : ''}`}>
        <div className="ai-chat-history-item-row">
          <button
            type="button"
            className="ai-chat-history-item-main"
            onClick={() => openSession(session.id)}
          >
            <span className="ai-chat-history-item-title">
              {session.pinned && <PinFill width={11} className="ai-chat-pin-mark" />}
              {session.title || '未命名对话'}
            </span>
            <span className="ai-chat-history-item-meta">
              {isCurrent && <span className="ai-chat-current-badge">当前</span>}
              <span className="ai-chat-history-time">{formatHistoryTime(session.updatedAt)}</span>
            </span>
          </button>
          <button
            type="button"
            className={`ai-chat-icon-btn ${showActions ? 'on' : ''}`}
            onClick={() => setActionsId(showActions ? null : session.id)}
            aria-label={`更多操作：${session.title || '未命名对话'}`}
            title="更多操作"
            aria-expanded={showActions}
          >
            <EllipsisVertical width={16} />
          </button>
        </div>

        {showActions && (
          <div className="ai-chat-history-actions">
            <button
              type="button"
              className="ai-btn ghost mini"
              onClick={() => {
                togglePinChat(session.id)
                setActionsId(null)
              }}
            >
              {session.pinned ? '取消置顶' : '置顶'}
            </button>
            <button
              type="button"
              className="ai-btn ghost mini"
              onClick={() => {
                openRenameDialog(session.id, session.title)
                setActionsId(null)
              }}
            >
              重命名
            </button>
            <button
              type="button"
              className="ai-btn ghost danger mini"
              onClick={() => handleDelete(session)}
            >
              删除
            </button>
          </div>
        )}
      </div>
    )
  }

  const isNewSession = !messages.length && !input.trim() && !loading
  const canRestore = !!previousActiveId && sessions.some(s => s.id === previousActiveId)

  return (
    <div className="ai-card ai-chat-card">
      {historyView
        ? (
            <div className="ai-chat-history-view">
              <div className="ai-chat-history-view-head">
                <button
                  type="button"
                  className="ai-chat-icon-btn"
                  onClick={() => setHistoryView(false)}
                  aria-label="返回对话"
                  title="返回对话"
                >
                  <ArrowChevronLeft width={16} />
                </button>
                <div className="ai-chat-history-view-title">
                  历史对话
                  {sessions.length > 0 && <span className="ai-chat-bar-count">{sessions.length}</span>}
                </div>
                <button
                  type="button"
                  className="ai-chat-icon-btn"
                  onClick={handleNewChat}
                  aria-label="新建对话"
                  title="新建对话"
                >
                  <Plus width={16} />
                </button>
              </div>

              <div className="ai-chat-history-search">
                <Magnifier width={13} />
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="搜索标题或内容…"
                  aria-label="搜索历史对话"
                />
                {query && (
                  <button type="button" className="ai-chat-icon-btn" onClick={() => setQuery('')} aria-label="清空搜索" title="清空">
                    <Xmark width={12} />
                  </button>
                )}
              </div>

              <div className="ai-chat-history-list" onScroll={onListScroll}>
                {visibleSessions.length === 0 && (
                  <div className="ai-chat-empty">
                    <div className="ai-chat-empty-title">{sessions.length ? '没有匹配的对话' : '还没有历史对话'}</div>
                    <div className="ai-chat-empty-desc">
                      {sessions.length ? '换个关键词试试。' : '返回对话开始聊天后，会自动保存在这里。'}
                    </div>
                  </div>
                )}

                {hasPinned && pinnedSessions.length > 0 && (
                  <div className="ai-chat-history-group">置顶</div>
                )}
                {pinnedSessions.map(renderItem)}
                {hasPinned && normalSessions.length > 0 && (
                  <div className="ai-chat-history-group">最近对话</div>
                )}
                {normalSessions.map(renderItem)}

                {hasMore && (
                  <button
                    type="button"
                    className="ai-chat-history-more"
                    onClick={() => setVisibleLimit(v => Math.min(v + PAGE_SIZE, visibleSessions.length))}
                  >
                    显示更多（还有 {visibleSessions.length - visibleLimit} 条）
                  </button>
                )}
              </div>
            </div>
          )
        : (
            <>
              {context && (
                <div className="ai-chat-context">
                  <span className="ai-chat-context-label">已附加</span>
                  <span className="ai-chat-context-title" title={context.title || context.url}>
                    {context.title || context.url || '热榜条目'}
                  </span>
                  {context.url && (
                    <button
                      type="button"
                      className="ai-btn ghost mini"
                      onClick={() => window.open(context.url, '_blank', 'noopener,noreferrer')}
                    >
                      打开
                    </button>
                  )}
                  <button
                    type="button"
                    className="ai-btn ghost mini"
                    onClick={() => patchChat({ context: null, contextUsed: false })}
                    disabled={loading || !webSearchAvailable}
                  >
                    移除
                  </button>
                  {contextUsed && <span className="ai-chat-context-used">已随对话发送</span>}
                </div>
              )}

              <div ref={listRef} className={`ai-chat-list ${editingId ? 'editing' : ''}`} onScroll={onChatScroll}>
                {!messages.length && (
                  <div className="ai-chat-empty">
                    <div className="ai-chat-empty-title">开始一段对话</div>
                    <div className="ai-chat-empty-desc">可以直接提问，或从热榜右键「分析此条」带一条内容进来；输入 <code>/订阅 …</code> 可设置邮件订阅。</div>
                    <div className="ai-chat-suggestions">
                      {SUGGESTIONS.map(text => (
                        <button
                          key={text}
                          type="button"
                          className="ai-chip"
                          onClick={() => patchChat({ input: text })}
                          disabled={disabled || loading}
                        >
                          {text}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {messages.map(message => (
                  <Fragment key={message.id}>
                  <div className={`ai-chat-msg ${message.role} ${editingId === message.id ? 'is-editing' : ''}`}>
                    <div className="ai-chat-role">
                      {message.role === 'user' ? '你' : 'AI'}
                      {message.at ? <span className="ai-chat-time">{formatClock(message.at)}</span> : null}
                    </div>

                    {editingId === message.id
                      ? (
                          <div className="ai-chat-edit">
                            <div className="ai-chat-edit-head">
                              <div className="ai-chat-edit-heading">
                                <Pencil width={13} />
                                <span>编辑这条消息</span>
                              </div>
                              <span className="ai-chat-edit-hint">修改后将从这里重新生成回复</span>
                            </div>
                            <textarea
                              ref={editTextareaRef}
                              value={editingText}
                              onChange={e => setEditingText(e.target.value)}
                              rows={8}
                              aria-label="编辑已发送的消息"
                              disabled={loading}
                            />
                            <div className="ai-chat-edit-actions">
                              <button
                                type="button"
                                className="ai-chat-edit-cancel"
                                onClick={() => setEditingId(null)}
                                disabled={loading}
                              >
                                <Xmark width={14} />
                                取消
                              </button>
                              <button
                                type="button"
                                className="ai-chat-edit-submit"
                                onClick={submitEdit}
                                disabled={loading || !editingText.trim()}
                              >
                                <Check width={14} />
                                修改并重新生成
                              </button>
                            </div>
                          </div>
                        )
                      : message.role === 'assistant'
                        ? (
                            <div className="ai-chat-bubble">
                              {message.content
                                ? <Markdown className="ai-out ai-chat-md" text={message.content} />
                                : <span className="ai-chat-thinking">正在思考…</span>}
                              {streamingId === message.id && !!message.content && <span className="ai-chat-cursor" aria-hidden />}
                              {streamingId !== message.id && !!message.content && (
                                <div className="ai-chat-bubble-foot">
                                  {!!message.usage?.totalTokens && (
                                    <span className="ai-chat-usage">消耗 {message.usage.totalTokens.toLocaleString('en-US')} token</span>
                                  )}
                                  <button
                                    type="button"
                                    className="ai-chat-icon-btn"
                                    onClick={() => copyMessage(message.content)}
                                    aria-label="复制这条回复"
                                    title="复制这条回复"
                                  >
                                    <Copy width={13} />
                                  </button>
                                </div>
                              )}
                            </div>
                          )
                        : (
                            <>
                              <div className="ai-chat-bubble ai-chat-bubble-user">
                                <div className="whitespace-pre-wrap">{message.content}</div>
                              </div>
                              {/* 编辑 / 复制：放在气泡外右下角 */}
                              <div className="ai-chat-msg-actions">
                                <button
                                  type="button"
                                  className="ai-chat-icon-btn"
                                  onClick={() => beginEdit(message.id, message.content)}
                                  disabled={loading}
                                  aria-label="编辑这条消息"
                                  title="编辑"
                                >
                                  <Pencil width={13} />
                                </button>
                                <button
                                  type="button"
                                  className="ai-chat-icon-btn"
                                  onClick={() => copyMessage(message.content)}
                                  aria-label="复制这条消息"
                                  title="复制这条消息"
                                >
                                  <Copy width={13} />
                                </button>
                              </div>
                            </>
                          )}
                  </div>

                  {/* `/订阅 …` 确认卡：只在解析出改动、且没保存时挂在解析结果那条气泡下方 */}
                  {pendingSubscription
                    && pendingSubscription.messageId === message.id
                    && (!pendingSubscription.sessionId || pendingSubscription.sessionId === activeId) && (
                    <div className="ai-chat-sub-confirm ai-nl-confirm">
                      <div className="ai-nl-confirm-title">将应用以下修改：</div>
                      <ul className="ai-nl-list">
                        {pendingSubscription.summary.map((line, index) => <li key={index}>{line}</li>)}
                      </ul>
                      <div className="ai-srcinfo" style={{ marginTop: 6 }}>
                        保存后规则：{pendingSubscription.ruleText}
                      </div>
                      {pendingSubscription.warnings.map((line, index) => (
                        <div className="ai-warn" key={index}>{line}</div>
                      ))}
                      <div className="ai-opts">
                        <button
                          type="button"
                          className="ai-btn primary"
                          onClick={() => void applyChatSubscription()}
                          disabled={pendingSubscription.applying}
                        >
                          {pendingSubscription.applying ? '保存中…' : '应用并保存'}
                        </button>
                        <button
                          type="button"
                          className="ai-btn"
                          onClick={cancelChatSubscription}
                          disabled={pendingSubscription.applying}
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  )}
                  </Fragment>
                ))}

                {!atBottom && !!messages.length && (
                  <button type="button" className="ai-chat-jump" onClick={jumpToBottom} aria-label="回到底部" title="回到底部">
                    <ArrowChevronDown width={16} />
                  </button>
                )}
              </div>

              {error && (
                <div className="ai-warn ai-chat-error" role="alert">
                  <span className="ai-chat-error-msg">{error}</span>
                  <span className="ai-chat-error-actions">
                    <button type="button" className="ai-btn mini" onClick={() => void retryChat()} disabled={loading}>
                      <ArrowsRotateRight width={13} />
                      重试
                    </button>
                    <button type="button" className="ai-btn mini ghost" onClick={() => patchChat({ error: null })} aria-label="关闭错误提示" title="关闭">
                      <Xmark width={13} />
                    </button>
                  </span>
                </div>
              )}

              <div className="ai-chat-bottom-dock">
                <div className="ai-chat-bottom-bar">
                  <button
                    type="button"
                    className={`ai-chat-bar-btn new ${isNewSession ? 'on' : ''}`}
                    onClick={handleNewChat}
                    disabled={loading}
                  >
                    <Plus width={15} />
                    新建对话
                  </button>
                  <button
                    type="button"
                    className="ai-chat-bar-btn"
                    onClick={openHistory}
                  >
                    <ListUl width={16} />
                    历史对话
                    {sessions.length > 0 && <span className="ai-chat-bar-count">{sessions.length}</span>}
                  </button>
                  <button
                    type="button"
                    className="ai-chat-bar-btn"
                    onClick={() => {
                      restoreLastChat()
                      notify('已还原上次对话')
                    }}
                    disabled={!canRestore || loading}
                    title={canRestore ? '还原上次对话' : '暂无可还原的对话'}
                  >
                    <ArrowRotateLeft width={16} />
                    还原对话
                  </button>
                </div>

                <div className="ai-chat-composer">
                  <textarea
                    ref={composerRef}
                    value={input}
                    onChange={e => patchChat({ input: e.target.value })}
                    onKeyDown={onKeyDown}
                    placeholder={contextUsed || !context ? '继续追问…（Enter 发送，Shift+Enter 换行）' : '说说你想怎么分析这条内容…'}
                    disabled={loading}
                    rows={3}
                  />
                  <span className="ai-chat-composer-hint">Enter 发送 · Shift+Enter 换行</span>
                  <div className="ai-chat-composer-actions-right">
                    <button
                      type="button"
                      className={`ai-chat-web-search-toggle ${webSearch ? 'on' : ''}`}
                      aria-pressed={webSearch}
                      aria-label={webSearch ? '关闭联网搜索' : '开启联网搜索'}
                      title={webSearchAvailable ? '联网搜索（开启后持续生效，直到手动关闭）' : '请先在设置中配置联网搜索源'}
                      onClick={toggleWebSearch}
                      disabled={loading}
                    >
                      <Magnifier width={15} />
                      <span>联网</span>
                    </button>
                    <button type="button" className="ai-btn primary" onClick={send} disabled={disabled || loading || !input.trim()}>
                      {loading ? '回复中…' : '发送'}
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}

      {undo && (
        <div className="ai-chat-undo">
          <span className="ai-chat-undo-text">已删除「{undo.session.title || '未命名对话'}」</span>
          <button type="button" className="ai-btn ghost mini" onClick={undoDelete}>
            撤销
          </button>
        </div>
      )}

      {renameTarget && (
        <div className="ai-chat-dialog-backdrop" onClick={() => setRenameTarget(null)}>
          <div className="ai-chat-dialog" role="dialog" aria-label="重命名对话" onClick={e => e.stopPropagation()}>
            <div className="ai-chat-dialog-title">重命名对话</div>
            <input
              className="ai-chat-rename-input"
              value={renamingText}
              autoFocus
              maxLength={40}
              onChange={e => setRenamingText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  e.stopPropagation()
                  submitRename()
                }
                else if (e.key === 'Escape') {
                  e.preventDefault()
                  e.stopPropagation()
                  setRenameTarget(null)
                }
              }}
              aria-label="对话标题"
            />
            <div className="ai-chat-dialog-actions">
              <button type="button" className="ai-btn ghost mini" onClick={autoName} disabled={autoBusy}>
                {autoBusy ? '生成中…' : '自动命名'}
              </button>
              <span className="ai-chat-dialog-spacer" />
              <button type="button" className="ai-btn ghost mini" onClick={() => setRenameTarget(null)}>
                取消
              </button>
              <button type="button" className="ai-btn primary mini" onClick={submitRename} disabled={!renamingText.trim()}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

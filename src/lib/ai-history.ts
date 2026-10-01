/*
 * @Description: AI 生成结果历史（**服务端存储**，多浏览器共享）
 *
 * 为什么从 localStorage 改到服务端：用户要求「保存到远端，这样可以共享」。
 * 存成项目内 `data/ai-history.json`（可被 AI_HISTORY_FILE 覆盖），沿用 cookies 管理的
 * 「原子写 + 保存前 .bak」模式；该文件已加入打包器 exclude，不会进交付包。
 *
 * 每个功能各自保留最近 MAX_PER_FEATURE 条，避免文件无限增长
 * （单条约 1-4KB，30 条 × 4 类仍在百 KB 量级）。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { ChatUsage } from '@/lib/ai'

export type AiFeature = 'item' | 'summary' | 'briefing' | 'analyze'

export interface AiHistoryRow {
  title: string
  summary: string
  url?: string
}

export interface AiHistoryEntry {
  id: string
  feature: AiFeature
  /** 生成时间（毫秒） */
  at: number
  /** 一行摘要，用于列表展示，如「微博 · 前 10 条」 */
  label: string
  /** 单块文本结果（单条分析 / 简报 / 趋势分析） */
  text?: string
  /** 多行结果（摘要） */
  rows?: AiHistoryRow[]
  /** 附加说明，如「依据：仅标题」「命中缓存」 */
  note?: string
  /** 本次生成消耗的 token（内容本身的成本；命中缓存时仍记录原始消耗） */
  tokens?: ChatUsage
}

const MAX_PER_FEATURE = 30

function historyFile(): string {
  return process.env.AI_HISTORY_FILE || join(process.cwd(), 'data', 'ai-history.json')
}

function readAll(): AiHistoryEntry[] {
  try {
    const file = historyFile()
    if (!existsSync(file))
      return []
    const raw = readFileSync(file, 'utf8').trim()
    if (!raw)
      return []
    const parsed = JSON.parse(raw)
    const list = Array.isArray(parsed) ? parsed : parsed?.entries
    return Array.isArray(list) ? list.filter((e): e is AiHistoryEntry => !!e && typeof e === 'object' && typeof e.id === 'string') : []
  }
  catch {
    // 文件损坏时不让历史拖垮主流程
    return []
  }
}

function writeAll(entries: AiHistoryEntry[]): void {
  const file = historyFile()
  mkdirSync(dirname(file), { recursive: true })
  if (existsSync(file))
    writeFileSync(`${file}.bak`, readFileSync(file)) // 保存前备份，与 cookies 管理一致

  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify({ entries }, null, 2)}\n`, 'utf8')
  renameSync(tmp, file) // 原子写
}

/** @description: 取历史（按时间倒序；传 feature 则只取该类） */
export function listHistory(feature?: AiFeature): AiHistoryEntry[] {
  const all = readAll().sort((a, b) => b.at - a.at)
  return feature ? all.filter(e => e.feature === feature) : all
}

/** @description: 追加一条记录（同功能只留最近 MAX_PER_FEATURE 条） */
export function addHistory(entry: Omit<AiHistoryEntry, 'id' | 'at'>): AiHistoryEntry {
  const record: AiHistoryEntry = {
    ...entry,
    id: `${entry.feature}-${Date.now()}-${createHash('sha1').update(`${entry.label}${Date.now()}${Math.random()}`).digest('hex').slice(0, 6)}`,
    at: Date.now(),
  }

  const others = readAll().filter(e => e.feature !== entry.feature)
  const sameFeature = [record, ...readAll().filter(e => e.feature === entry.feature)]
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_PER_FEATURE)

  writeAll([...sameFeature, ...others])
  return record
}

/** @description: 删除一条 */
export function removeHistory(id: string): boolean {
  const all = readAll()
  const next = all.filter(e => e.id !== id)
  if (next.length === all.length)
    return false
  writeAll(next)
  return true
}

/** @description: 清空某功能（不传则清空全部） */
export function clearHistory(feature?: AiFeature): number {
  const all = readAll()
  const next = feature ? all.filter(e => e.feature !== feature) : []
  writeAll(next)
  return all.length - next.length
}

export function historyFilePath(): string {
  return historyFile()
}

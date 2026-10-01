/*
 * @Author: 白雾茫茫丶<baiwumm.com>
 * @Date: 2025-11-20 11:05:40
 * @LastEditors: 白雾茫茫丶<baiwumm.com>
 * @LastEditTime: 2026-07-31 14:00:17
 * @Description: 热榜显示
 */
'use client'
import { BucketPaint, Gear, Grip } from '@gravity-ui/icons'
import {
  AlertDialog,
  Button,
  Checkbox,
  CheckboxGroup,
  cn,
  Label,
  Modal,
  toast,
} from '@heroui/react'
import Image from 'next/image'
import { useEffect, useMemo, useState } from 'react'

import { Sortable, SortableItem, SortableItemHandle } from '@/components/Sortable'
import { APP_OPEN_PREF_OPTIONS, getAppOpenPref, setAppOpenPref } from '@/lib/app-links'
import { HOT_ITEMS } from '@/enums'
import { useDeviceKind } from '@/hooks/use-device-kind'
import { useAppStore } from '@/store/useAppStore'
import { useHotSettingsStore } from '@/store/useHotSettingsStore'

import type { AppOpenPref } from '@/lib/app-links'

type HotKeys = typeof HOT_ITEMS.valueType

export default function HotSettings() {
  /** 源名过滤（35 个源在手机上翻找很累）；只影响显示，不改动已保存的配置 */
  const [keyword, setKeyword] = useState('')
  /** 移动端点击链接的打开方式（存在 localStorage，不进服务端配置） */
  const [appPref, setAppPref] = useState<AppOpenPref>('ask')
  useEffect(() => setAppPref(getAppOpenPref()), [])
  /** 桌面端 / 手机端各一套首页配置；按当前设备只显示/编辑对应端 */
  const device = useDeviceKind()
  const setEditDevice = useAppStore(state => state.setEditDevice)
  const desktop = useAppStore(state => state.desktop)
  const mobile = useAppStore(state => state.mobile)
  const { hiddenItems, sortItems } = device === 'mobile' ? mobile : desktop
  const setHiddenItems = useAppStore(state => state.setHiddenItems)
  const setSortItems = useAppStore(state => state.setSortItems)

  // 弹层开关提到 store：除头部按钮外，页脚「共 N 个数据源」也要能打开
  const hotSettingsOpen = useHotSettingsStore(state => state.open)
  const setHotSettingsOpen = useHotSettingsStore(state => state.setOpen)

  // 本弹层始终编辑「当前设备」那一端：把 store 的写入端同步过去，避免落到另一端。
  useEffect(() => {
    setEditDevice(device)
  }, [device, setEditDevice])

  /**
   * 👇 源数据（唯一可信）
   */
  const sourceValues = useMemo(
    () => HOT_ITEMS.items.map(i => i.value),
    [],
  )

  /**
   * 👇 排序兜底（解决你新增一条 HOT_ITEMS 不显示的问题）
   */
  const safeSortItems = useMemo(
    () => normalizeSortItems(sourceValues, sortItems),
    [sourceValues, sortItems],
  )

  /**
   * 👇 隐藏项兜底（防止源数据删了还留在 hiddenItems）
   */
  const safeHiddenItems = useMemo(() => {
    const sourceSet = new Set(sourceValues)
    return (hiddenItems ?? []).filter(v => sourceSet.has(v))
  }, [hiddenItems, sourceValues])

  /**
   * 👇 当前显示中的 items（CheckboxGroup 使用）
   */
  const visibleValues = useMemo(() => {
    const hiddenSet = new Set(safeHiddenItems)
    return sourceValues.filter(v => !hiddenSet.has(v))
  }, [safeHiddenItems, sourceValues])

  /**
   * 👇 勾选变化 → 反推出 hiddenItems
   */
  const onChange = (values: string[]) => {
    const visibleSet = new Set(values)
    const nextHidden = sourceValues.filter(v => !visibleSet.has(v))
    setHiddenItems(nextHidden)
  }

  // 恢复默认设置
  const resetConfig = () => {
    setSortItems(HOT_ITEMS.values)
    setHiddenItems([])
    toast.success('操作成功！', {
      timeout: 2000,
    })
  }

  /**
   * 👇（可选但强烈推荐）
   * 当发现 sortItems 不完整时，自动修复 store
   * 新增项会被持久化，不只是 UI 显示
   */
  useEffect(() => {
    if (!sortItems)
      return

    if (safeSortItems.join() !== sortItems.join()) {
      setSortItems(safeSortItems)
    }
  }, [safeSortItems])

  /**
   * 👇 隐藏项同样要「对齐到现存源并写回」
   * 否则删掉某个数据源后，它的 id 会永远留在 hiddenItems 里
   *（渲染时虽会被 safeHiddenItems 滤掉，但配置里会一直带着无效项）。
   */
  useEffect(() => {
    if (!hiddenItems)
      return

    if (safeHiddenItems.join() !== hiddenItems.join()) {
      setHiddenItems(safeHiddenItems)
    }
  }, [safeHiddenItems])

  /** 单个源的选择框（排序模式与筛选模式共用） */
  const renderItem = (value: string) => {
    const raw = HOT_ITEMS.raw(value)
    if (!raw)
      return null
    return (
      <Checkbox
        value={value}
        // 统一格高（手机 44px / 桌面 40px）：长源名折两行时若由内容撑高，
        // 那一格会比同行高一截、第二行文字又贴到圆角边缘（用户反馈的"图层溢出"）。
        // 定高 + 行高收紧后，两行文字也稳稳落在框内。
        className={cn(
          'group mt-0 gap-2 h-11 sm:h-10 border border-default bg-surface px-2 py-0 transition-all rounded-xl',
          'data-[selected=true]:bg-accent-soft hover:bg-accent-soft',
        )}
      >
        <Checkbox.Content className="flex flex-row items-center justify-between gap-1 w-full h-full">
          <div className="flex items-center gap-1 min-w-0">
            <SortableItemHandle className="text-muted-foreground shrink-0 hidden sm:inline-flex">
              <Grip width={16} />
            </SortableItemHandle>
            <Image
              alt={raw.label}
              height={16}
              src={`/images/${value}.svg`}
              width={16}
              className="rounded-md shrink-0"
            />
            {/* 手机上这里原本是 truncate：列宽只有 ~95px，35 个源全部被截成 1 个字（320px 时是 0 个字）。
                改成允许两行 + 允许换行，窄列下也能读全。 */}
            <Label className="flex-1 text-[11px] sm:text-xs leading-[1.15] line-clamp-2 break-words">{raw.label}</Label>
          </div>
          <Checkbox.Control className="size-4 shrink-0">
            <Checkbox.Indicator />
          </Checkbox.Control>
        </Checkbox.Content>
      </Checkbox>
    )
  }

  const filtered = keyword.trim()
    ? safeSortItems.filter((value) => {
        const raw = HOT_ITEMS.raw(value)
        return raw ? raw.label.includes(keyword.trim()) || value.includes(keyword.trim().toLowerCase()) : false
      })
    : safeSortItems

  return (
    <Modal isOpen={hotSettingsOpen} onOpenChange={setHotSettingsOpen}>
      <Button
        aria-label="热点榜单设置"
        size="sm"
        variant="ghost"
        isIconOnly
      >
        <BucketPaint />
      </Button>
      <Modal.Backdrop isDismissable={false} isKeyboardDismissDisabled>
        <Modal.Container size="lg" className="max-h-[90dvh]">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>
                <div className="flex items-center gap-2">
                  <Modal.Icon className="bg-accent-soft text-accent-soft-foreground">
                    <Gear />
                  </Modal.Icon>
                  <h1 className="font-bold">热榜设置</h1>
                </div>
              </Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              {/* 桌面端 / 手机端各一套配置；本弹层只编辑当前设备那一端，不提供手动切换 */}
              <div className="mb-3 text-[11px] text-muted leading-tight">
                当前设备：{device === 'mobile' ? '手机端' : '桌面端'}。桌面端与手机端各存一套，互不影响；换到另一端打开本弹层即可编辑那边的配置。
              </div>
              <input
                type="search"
                value={keyword}
                onChange={e => setKeyword(e.target.value)}
                placeholder={`筛选源名（共 ${safeSortItems.length} 个）`}
                aria-label="筛选数据源"
                className="mb-3 w-full px-3 py-2 text-sm rounded-lg border border-default bg-surface outline-none focus:border-accent"
              />
              {keyword.trim() && (
                <p className="mb-2 text-xs text-muted">
                  筛选中（{filtered.length} 个命中）——此时不能拖拽排序，清空关键词即可恢复
                </p>
              )}
              <CheckboxGroup
                name="hot-items"
                value={visibleValues}
                onChange={onChange}
              >
                {keyword.trim()
                  ? (
                      // 筛选态：只渲染命中的源，且**不接拖拽**（拖拽会按"当前可见顺序"回写，丢掉被筛掉的源）
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
                        {filtered.map(value => (
                          <div key={value}>{renderItem(value)}</div>
                        ))}
                      </div>
                    )
                  : (
                      <Sortable
                        getItemValue={item => item}
                        strategy="grid"
                        value={safeSortItems}
                        onValueChange={setSortItems}
                        // 手机 2 列（每列约 150px 起，标签可读）；≥640px 保持原来的 3 列
                        className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3"
                      >
                        {safeSortItems.map(value => (
                          <SortableItem key={value} value={value}>
                            {renderItem(value)}
                          </SortableItem>
                        ))}
                      </Sortable>
                    )}
              </CheckboxGroup>
              {/* 移动端点链接时的打开方式：有对应 App 的源会先询问 */}
                            {/* 桌面端不显示：这个开关只影响手机端点链接的行为 */}
              <div className="md:hidden mt-4 pt-3 border-t border-separator flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="text-xs font-medium">移动端点链接</div>
                  <div className="text-[11px] text-muted leading-tight">
                    微博 / B站 / 小黑盒 等已装 App 的源，可提示跳到 App
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  {APP_OPEN_PREF_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => {
                        setAppOpenPref(opt.value)
                        setAppPref(opt.value)
                      }}
                      className={cn(
                        'px-2.5 py-1.5 rounded-lg border text-xs cursor-pointer transition-colors',
                        appPref === opt.value
                          ? 'border-accent text-accent bg-accent/10'
                          : 'border-default text-muted hover:bg-surface-tertiary',
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </Modal.Body>
            <Modal.Footer>
              <AlertDialog>
                <Button className="w-full">恢复默认设置</Button>
                <AlertDialog.Backdrop variant="blur">
                  <AlertDialog.Container size="md">
                    <AlertDialog.Dialog>
                      <AlertDialog.CloseTrigger />
                      <AlertDialog.Header>
                        <AlertDialog.Icon status="warning" />
                        <AlertDialog.Heading>恢复默认设置？</AlertDialog.Heading>
                      </AlertDialog.Header>
                      <AlertDialog.Body>
                        会把「{device === 'mobile' ? '手机端' : '桌面端'}」的排序与显示配置恢复为系统默认状态，不影响另一端。
                      </AlertDialog.Body>
                      <AlertDialog.Footer>
                        <Button variant="tertiary" slot="close">取消</Button>
                        <Button variant="danger" slot="close" onPress={resetConfig}>确认</Button>
                      </AlertDialog.Footer>
                    </AlertDialog.Dialog>
                  </AlertDialog.Container>
                </AlertDialog.Backdrop>
              </AlertDialog>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}

/**
 * 👇 核心：排序归一化
 * - 保留旧顺序
 * - 自动补齐新增项
 * - 自动剔除已删除项
 */
function normalizeSortItems(source: HotKeys[], sortItems?: HotKeys[]) {
  const sourceSet = new Set(source)

  // 保留仍然存在的排序项
  const normalized = (sortItems ?? []).filter(v => sourceSet.has(v))

  // 找出新增项
  const missing = source.filter(v => !normalized.includes(v))

  return [...normalized, ...missing]
}

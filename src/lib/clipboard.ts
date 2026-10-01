/*
 * @Description: 复制文本到剪贴板（带非安全上下文降级）
 *
 * 为什么需要它：`navigator.clipboard` 只在**安全上下文**（HTTPS 或 localhost）下可用。
 * 本站常以 `http://<局域网IP>:3000` 访问，此时 `navigator.clipboard` 为 undefined，
 * 直接调用会抛 TypeError，界面就会误报「复制失败，请检查剪贴板权限」。
 *
 * 两级策略：
 *  1) 安全上下文优先用异步 Clipboard API（可写大文本、体验最好）；
 *  2) 失败或不可用时，兜底到临时 <textarea> + document.execCommand('copy')
 *     —— 依赖用户手势，但 HTTP 页面同样可用。
 * 返回是否成功，调用方据此给出准确提示。
 */
export async function copyText(text: string): Promise<boolean> {
  if (!text)
    return false

  // 1) 安全上下文（HTTPS / localhost）优先
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  }
  catch {
    // 权限被拒 / 文档失焦等：继续走兜底
  }

  // 2) 兜底：临时 textarea + execCommand
  if (typeof document === 'undefined')
    return false
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    // 放在视口内但不可见，避免移动端滚动跳动
    ta.style.position = 'fixed'
    ta.style.top = '0'
    ta.style.left = '0'
    ta.style.width = '1px'
    ta.style.height = '1px'
    ta.style.padding = '0'
    ta.style.border = 'none'
    ta.style.outline = 'none'
    ta.style.boxShadow = 'none'
    ta.style.background = 'transparent'
    ta.style.opacity = '0'

    document.body.appendChild(ta)

    // 记住并恢复原有选区，避免复制把用户的选中状态清掉
    const selection = document.getSelection()
    const previousRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null

    ta.focus()
    ta.select()
    // iOS Safari 需要显式 setSelectionRange 才会选中
    ta.setSelectionRange(0, text.length)

    const ok = document.execCommand('copy')

    ta.remove()
    if (selection && previousRange) {
      selection.removeAllRanges()
      selection.addRange(previousRange)
    }
    return ok
  }
  catch {
    return false
  }
}

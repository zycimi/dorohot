/*
 * @Description: 浮层的挂载点（2026-09-15）
 *
 * React Aria 的弹层（Modal / Drawer）打开时，会把 `body` 下**其它所有子元素标成 `inert`**，
 * 而 `inert` 子树不参与命中测试 —— 挂在 body 上的浮层会"看得见、点不到"。
 * 所以有弹层时统一挂进弹层对话框内部（弹层链路上没有 transform，`position: fixed` 仍按视口定位）。
 */
export function portalHost(): HTMLElement {
  const dialog = document.querySelector<HTMLElement>('[data-slot="modal-dialog"], [data-slot="drawer-dialog"]')
  return dialog ?? document.body
}

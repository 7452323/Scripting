/**
 * 日历 — 入口
 *
 * 全屏呈现，左上角关闭按钮。
 */

import { Navigation, Script } from "scripting"
import { App } from "./app"

/** 包一层以便把 Navigation.useDismiss 注入给 App */
function Root() {
  const dismiss = Navigation.useDismiss()
  return <App onClose={() => dismiss()} />
}

async function main() {
  try {
    // 注意：通知权限不在这里申请（ScriptingApi 不含 notifications），
    // 首次调度通知时由系统自行弹窗；若始终收不到，请到 Scripting 的
    // 通知设置里确认已授权。
    await Script.requestAccess(["calendar", "reminders"])
  } catch (e) {
    /* 权限接口在部分环境不可用，忽略；首次使用时会由系统弹窗询问 */
  }

  try {
    await Navigation.present({
      element: <Root />,
      modalPresentationStyle: "overFullScreen",
    })
  } finally {
    Script.exit()
  }
}

main()

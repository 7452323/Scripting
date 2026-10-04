/**
 * widget.tsx — 桌面小组件
 *
 * 版式按尺寸自动决定，不需要配置：
 *   small  —— 本月月历
 *   medium —— 左边月历 + 右边待办
 *   large  —— 月历 + 下方待办 / 日子倒数
 *
 * 背景色在设置页里选（默认白色），是**浅 / 深双值**，交给系统的 `widgetBackground`
 * 后会自动跟随系统浅色 / 深色模式，且在透明 / 毛玻璃 / accented 模式下自动跳过。
 *
 * 视图本体在 widget_views.tsx —— 与设置页里的「小组件预览」共用同一份渲染代码。
 *
 * 注意：
 * - 小组件里不能用 useState / useEffect（渲染一次就结束）。
 * - `Widget.present()` 之后执行上下文立即销毁，所有数据必须先准备好。
 */

import { Widget } from "scripting"

import type { AgendaItem, DayItem, TodoItem } from "./data"
import { loadDays, loadSystemEvents, loadSystemTodos } from "./data"
import { addDays, startOfDay } from "./lunar"
import { applyAccentTheme, applyAppearance } from "./theme"
import { loadSettings } from "./settings"
import { WIDGET_BACKGROUND, WidgetContent, type WidgetSize } from "./widget_views"

/** 系统小组件尺寸 → 内部尺寸 */
function familyToSize(family: string): WidgetSize {
  if (family === "systemSmall") return "small"
  if (family === "systemLarge") return "large"
  return "medium"
}

async function main() {
  const settings = loadSettings()

  // 小组件是独立进程，App 里的 useColorScheme 在这里拿不到；
  // 直接读 Device 并展开配色，这样文字 / 分隔线 / 强调色在深色下才正确。
  // （背景色不依赖它 —— 那是浅 / 深双值，由系统自己选。）
  applyAccentTheme(settings.accent)
  applyAppearance(Device.colorScheme)

  const today = startOfDay(new Date())
  const size = familyToSize(Widget.family)

  const days = loadDays(today)
  let events: AgendaItem[] = []
  let todos: TodoItem[] = []

  try {
    // 月历要靠事件打点，所以任何尺寸都需要事件
    events = await loadSystemEvents(today, addDays(today, 45))
    if (size === "medium" || size === "large") {
      todos = await loadSystemTodos()
    }
  } catch (e) {
    // 没有日历 / 提醒事项权限时留空，由视图显示占位文案
  }

  Widget.present(
    <WidgetContent
      size={size}
      days={days}
      events={events}
      todos={todos}
      today={today}
      background={WIDGET_BACKGROUND}
    />
  )
}

main()

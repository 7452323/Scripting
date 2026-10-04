/**
 * widget.tsx — 桌面小组件
 *
 * 版式按尺寸自动决定，不需要配置：
 *   small  —— 本月月历
 *   medium —— 左边月历 + 右边待办
 *   large  —— 月历 + 下方待办 / 日子倒数
 *
 * 背景：只声明 `widgetBackground`，值不设自定义颜色（`undefined`）—— 写法参照「一言小组件」，
 * 没开颜色背景时就是 undefined。不铺底就交给 Scripting / 系统：普通组件用系统默认材质，
 * 透明背景 / 模糊背景 / 图片模拟透明组件直接透出壁纸 / 模糊层。
 * 写死成白 / 黑这种不透明底色只会把底衬盖掉（那就是「透明背景没了」的来因）。
 *
 * 视图本体在 widget_views.tsx —— 与设置页里的「小组件预览」共用同一份渲染代码。
 *
 * 注意：
 * - 小组件里不能用 useState / useEffect（渲染一次就结束）。
 * - `Widget.present()` 之后执行上下文立即销毁，所有数据必须先准备好。
 * - 文档「使用说明」要求脚本结束前调用 `Script.exit()`。
 */

import { Script, Widget } from "scripting"

import type { AgendaItem, DayItem, TodoItem } from "./data"
import { loadDays, loadSystemEvents, loadSystemTodos } from "./data"
import { addDays, startOfDay } from "./lunar"
import { applyAccentTheme, applyAppearance } from "./theme"
import { loadSettings } from "./settings"
import { WidgetContent, type WidgetSize } from "./widget_views"

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
    <WidgetContent size={size} days={days} events={events} todos={todos} today={today} />
  )

  // 文档「使用说明」：脚本结束后应调用 Script.exit() 以确保小组件正常退出
  try {
    Script.exit()
  } catch (e) {
    // 小组件环境下 present 之后上下文可能已销毁，忽略
  }
}

main()

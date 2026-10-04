import { App } from "./app"
import { loadDays, sampleEvents, sampleTodos } from "./data"
import { startOfDay } from "./lunar"

/**
 * 预览用：注入示例数据，便于在没有权限的环境下检查视觉。
 *
 * 注意：`preview_ui` 自带外观控制，`preferredColorScheme` 在这里不生效，
 * 所以**深色模式无法在预览里验证**，需要真机切换系统外观。
 */
export default function Preview() {
  const today = startOfDay(new Date())
  return (
    <App
      onClose={() => {}}
      previewEvents={sampleEvents(today)}
      previewTodos={sampleTodos(today)}
      previewDays={loadDays(today)}
      previewTab="days"
    />
  )
}

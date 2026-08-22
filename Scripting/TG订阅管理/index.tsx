import { Navigation, Script, Widget } from "scripting"
import { getSource, setCache } from "./store"
import { fetchTelegramAudience } from "./telegram"
import { SettingsView } from "./SettingsView"

// ==========================================
// run 入口
// - deep link action=refresh：后台静默刷新缓存后立即退出
// - 否则：呈现配置页面，dismiss 后退出
// ==========================================

/** 解析当前运行携带的 action 参数 */
function resolveAction(): string | null {
  const scriptAny = Script as any
  if (scriptAny.query && scriptAny.query.action) {
    return scriptAny.query.action
  }
  if (scriptAny.url) {
    try {
      return new URL(scriptAny.url).searchParams.get("action")
    } catch {
      // 忽略解析失败
    }
  }
  return null
}

/** 点击小组件触发的后台静默刷新：拉取最新数据、刷新小组件、不进入 App */
async function silentRefresh() {
  const source = getSource()
  if (source) {
    try {
      const fresh = await fetchTelegramAudience(source)
      setCache(fresh)
      Widget.reloadAll()
    } catch {
      // 静默刷新失败则保留旧缓存，不打扰
    }
  }
  Script.exit()
}

async function run() {
  if (resolveAction() === "refresh") {
    await silentRefresh()
    return
  }

  try {
    await Navigation.present(<SettingsView />)
  } finally {
    Script.exit()
  }
}

run()

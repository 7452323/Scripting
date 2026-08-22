import { Widget } from "scripting"
import type { TelegramAudience } from "./types"
import { getCache, getSource, getTheme, setCache } from "./store"
import { fetchTelegramAudience } from "./telegram"
import { WidgetView } from "./WidgetView"

// ==========================================
// 官方 widget 入口（Script.env === "widget"）
// 后台定时渲染：取缓存 → 尝试刷新 → present，30 分钟后自更新。
// 注意：widget 入口内不得使用 useState/useEffect。
// ==========================================
async function present() {
  const source = getSource()
  const theme = getTheme()
  let data: TelegramAudience | null = getCache()
  let error: string | undefined

  if (source) {
    try {
      data = await fetchTelegramAudience(source)
      setCache(data)
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    }
  }

  Widget.present(
    <WidgetView data={data} error={source ? error : undefined} theme={theme} transparentBackground={Widget.isTransparentBackground} />,
    {
      reloadPolicy: {
        policy: "after",
        date: new Date(Date.now() + 30 * 60 * 1000),
      },
    }
  )
}

present()

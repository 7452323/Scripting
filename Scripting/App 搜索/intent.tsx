// ============================================================
// App Search — Intent (Shortcuts / Share Sheet)
// 输入: 文本 (App 名称)
// 输出: 搜索结果文本
// ============================================================
import { Script, Intent, fetch } from "scripting"

interface AppResult {
  trackId: number
  trackName: string
  bundleId: string
  artistName: string
  averageUserRating?: number
  price: number
  formattedPrice: string
}

async function run() {
  const input = Intent.shortcutParameter
  const term =
    input?.type === "text" ? input.value.toString().trim() :
    Intent.textsParameter?.[0]?.trim() || ""

  if (!term) {
    Script.exit(Intent.text("请输入 App 名称"))
    return
  }

  try {
    const encoded = encodeURIComponent(term)
    const url = `https://itunes.apple.com/search?term=${encoded}&entity=software&country=cn&limit=10`

    const response = await fetch(url)
    if (!response.ok) {
      Script.exit(Intent.text(`搜索失败 (HTTP ${response.status})`))
      return
    }

    const data = await response.json()
    const results: AppResult[] = (data.results || []).filter(
      (r: any) => r.trackId && r.bundleId
    )

    if (results.length === 0) {
      Script.exit(Intent.text(`未找到匹配 "${term}" 的 App`))
      return
    }

    // 格式化输出
    const lines = results.map((app, i) => {
      const rating = app.averageUserRating
        ? ` ★${app.averageUserRating.toFixed(1)}`
        : ""
      const priceText = app.price === 0 ? "免费" : app.formattedPrice || `$${app.price.toFixed(2)}`
      return `${i + 1}. ${app.trackName}${rating}\n   Bundle: ${app.bundleId}\n   价格: ${priceText}\n   链接: https://apps.apple.com/app/${app.trackId}`
    })

    Script.exit(
      Intent.text(
        `🔍 "${term}" 搜索结果 (${results.length}):\n\n${lines.join("\n\n")}`
      )
    )
  } catch (err: any) {
    Script.exit(Intent.text(`搜索失败: ${err.message || "未知错误"}`))
  }
}

run()

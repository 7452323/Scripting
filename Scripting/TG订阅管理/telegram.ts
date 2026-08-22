import { fetch } from "scripting"
import type { AudienceType, TelegramAudience } from "./types"
import { formatAudience } from "./format"

// ==========================================
// Telegram 公开网页抓取与解析
// ==========================================

/** 去除 HTML 标签与常见实体，压缩空白 */
function decodeHTML(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim()
}

/** 从 HTML 中提取指定 og / meta property 的 content */
function meta(html: string, property: string): string | undefined {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${escaped}["']`, "i"),
  ]
  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match?.[1]) return decodeHTML(match[1])
  }
  return undefined
}

/** 归一化用户输入为 { source（展示）, url（抓取） } */
export function normalizeTelegramSource(input: string): { source: string; url: string } {
  let value = input.trim()
  if (!value) throw new Error("请输入频道或群组链接/公开 ID")

  value = value.replace(/^tg:\/\/resolve\?domain=/i, "")
  if (/^-?\d+$/.test(value)) {
    throw new Error("Telegram 数字内部 ID 无法通过公开网页查询")
  }

  if (/^https?:\/\//i.test(value)) {
    let parsed: URL
    try {
      parsed = new URL(value)
    } catch {
      throw new Error("链接格式不正确")
    }
    if (!/(^|\.)t\.me$/i.test(parsed.hostname) && !/(^|\.)telegram\.me$/i.test(parsed.hostname)) {
      throw new Error("仅支持 t.me / telegram.me 链接")
    }
    const parts = parsed.pathname.split("/").filter(Boolean)
    if (parts[0] === "s") parts.shift()
    if (!parts[0]) throw new Error("链接中没有频道或群组 ID")
    if (parts[0] === "joinchat" && parts[1]) {
      value = `+${parts[1]}`
    } else if (parts[0] === "c") {
      throw new Error("内部链接不是公开主页")
    } else {
      value = parts[0]
    }
  }

  value = value.replace(/^@/, "").replace(/^\/+|\/+$/g, "")
  if (value.startsWith("joinchat/")) {
    value = `+${value.slice("joinchat/".length)}`
  }
  if (!value || (!value.startsWith("+") && !/^[A-Za-z0-9_]{5,}$/.test(value))) {
    throw new Error("请填写公开用户名（如 @telegram）或完整 t.me 链接")
  }

  return {
    source: value.startsWith("+") ? `https://t.me/${value}` : `@${value}`,
    url: `https://t.me/${value}`,
  }
}

/** 抓取并解析 Telegram 公开主页的受众数据 */
export async function fetchTelegramAudience(input: string): Promise<TelegramAudience> {
  const normalized = normalizeTelegramSource(input)
  const response = await fetch(normalized.url, {
    timeout: 15,
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
    },
  })
  if (!response.ok) throw new Error(`Telegram 请求失败（HTTP ${response.status}）`)

  const html = await response.text()
  const extraMatch = html.match(
    /<div[^>]*class=["'][^"']*tgme_page_extra[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
  )
  const extra = decodeHTML(extraMatch?.[1] ?? "")
  const countMatch = extra.match(/([\d\s,.\u00a0\u202f]+)\s+(subscribers?|members?)(?:\s|$)/i)
  if (!countMatch) {
    const title = meta(html, "og:title")
    throw new Error(title ? "该页面没有公开显示成员人数" : "找不到该频道/群组")
  }

  const audience = Number(countMatch[1].replace(/[^\d]/g, ""))
  if (!Number.isFinite(audience)) throw new Error("无法解析人数")
  const isSubscribers = /^subscriber/i.test(countMatch[2])
  const audienceType: AudienceType = isSubscribers ? "订阅者" : "成员"

  return {
    source: normalized.source,
    url: normalized.url,
    title: meta(html, "og:title") ?? normalized.source,
    audience,
    audienceText: formatAudience(audience),
    audienceType,
    avatarURL: meta(html, "og:image"),
    description: meta(html, "og:description"),
    fetchedAt: Date.now(),
  }
}

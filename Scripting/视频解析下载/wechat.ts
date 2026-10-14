/**
 * 微信公众号文章解析模块
 *
 * 参考实现：ParseHub `provider_api/weixin.py`（它解析 `window.cgiDataNew` 后取 `content_noencode`）
 *  · 文章页**不需要登录**，直接 GET 即可（`https://mp.weixin.qq.com/s/xxx` 或带签名的 `/s?src=…`）
 *  · 正文图片是**懒加载**：真地址在 `<img data-src="…">`（`src` 常是占位图）→ 这是关键
 *  · 正文里的视频有两种：腾讯视频 iframe（`video_iframe`，拿不到直链）与
 *    **视频号/微信视频**（`mpvideo.qpic.cn` / `findermp.video.qq.com`，有直链）
 *  · 异常页面（环境异常 / 已被删除 / 参数错误）要识别出来，别当成空内容
 */

import { fetch } from "scripting"

export interface WeChatResult {
  success: boolean
  platform?: string
  title?: string
  author?: string
  images?: string[]
  imagePreviews?: string[]
  video_url?: string | null
  videoUrls?: string[]
  cover_url?: string | null
  link?: string
  error?: string
  debug?: string[]
}

const UA_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49(0x18003128) NetType/WIFI Language/zh_CN"
const UA_PLAIN = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"

/** 是否是微信公众号文章链接 */
export function isWeChatArticle(url: string): boolean {
  return /mp\.weixin\.qq\.com\/s/i.test(url)
}

function decodeHtml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
}

function firstMatch(html: string, patterns: RegExp[]): string {
  for (const p of patterns) {
    const m = html.match(p)
    if (m?.[1]) return decodeHtml(m[1]).trim()
  }
  return ""
}

/** 判断是否是微信的「异常页」（无正文） */
function detectWeChatError(html: string): string {
  if (/该内容已被发布者删除|该内容已被删除|内容已被删除/.test(html)) return "该文章已被作者删除"
  if (/环境异常|请在微信客户端打开链接/.test(html) && !/js_content/.test(html)) return "微信拦截了非客户端访问（环境异常）"
  if (/参数错误|系统错误/.test(html) && !/js_content/.test(html)) return "链接参数错误或已过期"
  if (/此内容因违规无法查看|已被屏蔽/.test(html)) return "该文章已被屏蔽"
  return ""
}

/** 从正文里抽懒加载图片（data-src），过滤头像/二维码/表情 */
export function collectWeChatImages(html: string, debug: string[]): string[] {
  // 尽量只取正文区
  let scope = html
  const start = html.indexOf('id="js_content"')
  if (start > 0) {
    const end = html.indexOf('id="js_sg_bar"', start)
    scope = html.slice(start, end > start ? end : Math.min(html.length, start + 400000))
    debug.push("已定位正文区 js_content")
  } else {
    debug.push("没找到 js_content，改为全文扫描 data-src")
  }

  const raw = Array.from(scope.matchAll(/data-src\s*=\s*["']([^"']+)["']/gi)).map((m) => m[1])
  const out: string[] = []
  for (const url of raw) {
    const clean = decodeHtml(url).replace(/&amp;/g, "&")
    if (!/^https?:\/\//.test(clean)) continue
    if (!/(mmbiz|qpic)\.(qpic\.cn|qq\.com)|\.qpic\.cn/i.test(clean)) continue
    // 过滤头像 / 二维码 / 表情
    if (/wx_fmt=(gif|png|other)/i.test(clean) && /\/mmemojis?\//i.test(clean)) continue
    if (/mmbiz\.qlogo\.cn/.test(clean)) continue
    if (out.includes(clean)) continue
    out.push(clean)
  }
  // 兜底：图片消息（item_show_type=8）里 watermark_info.cdn_url
  if (!out.length) {
    const cdn = Array.from(html.matchAll(/"cdn_url"\s*:\s*"([^"]+)"/g)).map((m) => m[1].replace(/\\\//g, "/"))
    for (const url of cdn) {
      if (/^https?:\/\//.test(url) && !out.includes(url)) out.push(url)
    }
    if (out.length) debug.push("用 cdn_url 兜底取到图片")
  }
  return out
}

/** 正文里的视频直链（视频号 / 微信视频） */
export function collectWeChatVideos(html: string): string[] {
  const out: string[] = []
  const patterns = [
    /https?:\/\/mpvideo\.qpic\.cn\/[^"'\s\\]+/g,
    /https?:\/\/findermp\.video\.qq\.com\/[^"'\s\\]+/g,
    /https?:\/\/[a-z0-9.-]*\.qpic\.cn\/[^"'\s\\]+\.mp4[^"'\s\\]*/g,
  ]
  for (const p of patterns) {
    for (const m of html.matchAll(p)) {
      const url = decodeHtml(m[0]).replace(/\\\//g, "/").replace(/\\u0026/g, "&")
      if (!out.includes(url)) out.push(url)
    }
  }
  return out
}

/**
 * 解析微信公众号文章：返回正文图片（原图）与页内视频直链。
 */
export async function parseWeChatArticle(url: string, cookie: string = ""): Promise<WeChatResult> {
  const debug: string[] = []
  const result: WeChatResult = { success: false, platform: "wechat", link: url, debug }

  let html = ""
  for (const [label, ua] of [["微信内置浏览器", UA_IOS], ["普通 iOS", UA_PLAIN]] as [string, string][]) {
    try {
      const headers: Record<string, string> = { "User-Agent": ua, Accept: "text/html,application/xhtml+xml,*/*" }
      if (cookie) headers["Cookie"] = cookie
      const resp = await fetch(url, { headers, timeout: 25 } as any)
      html = await resp.text()
      debug.push(`${label} UA：HTTP ${resp.status}，${Math.round(html.length / 1024)}KB`)
      if (/id="js_content"/.test(html)) break
    } catch (error) {
      debug.push(`${label} UA 异常：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (!html) {
    result.error = "文章页请求失败"
    return result
  }

  const blocked = detectWeChatError(html)
  if (blocked) {
    result.error = blocked
    return result
  }

  result.title = firstMatch(html, [
    /<meta\s+property="og:title"\s+content="([^"]*)"/i,
    /<h1[^>]*id="activity-name"[^>]*>([\s\S]*?)<\/h1>/i,
    /<h1[^>]*class="rich_media_title"[^>]*>([\s\S]*?)<\/h1>/i,
  ]).replace(/<[^>]+>/g, "").trim()

  result.author = firstMatch(html, [
    /var\s+nickname\s*=\s*htmlDecode\("([^"]*)"\)/i,
    /var\s+nickname\s*=\s*"([^"]*)"/i,
    /<a[^>]*id="js_name"[^>]*>([\s\S]*?)<\/a>/i,
    /<strong[^>]*class="profile_nickname"[^>]*>([\s\S]*?)<\/strong>/i,
  ]).replace(/<[^>]+>/g, "").trim()

  const videos = collectWeChatVideos(html)
  const images = collectWeChatImages(html, debug)

  if (videos.length) {
    result.video_url = videos[0]
    result.videoUrls = videos
    debug.push(`页内视频 ${videos.length} 条`)
  }
  if (images.length) {
    result.images = images
    result.imagePreviews = images
    result.cover_url = videos.length ? result.cover_url || null : images[0]
    debug.push(`正文图片 ${images.length} 张`)
  } else if (videos.length) {
    // 视频号文章：封面取第一个视频的图（拿不到就算了）
    result.cover_url = firstMatch(html, [/<meta\s+property="og:image"\s+content="([^"]*)"/i]) || null
  }

  if (!result.success && !images.length && !videos.length) {
    result.error = "文章里没有找到可下载的图片或视频（可能是纯文字 / 已被限制）"
    return result
  }
  result.success = true
  return result
}

/**
 * 微信视频号（channels）解析模块
 *
 * 参考实现：ParseHub `provider_api/wxchannels.py`，两步接口：
 *  ① `POST https://yuanbao.tencent.com/api/weixin/get_parse_result`
 *     body `{type:"video_channel_url", url:"https://weixin.qq.com/sph/<shareId>", scene:1}`
 *     headers 需带 `Origin/Referer: https://yuanbao.tencent.com`（腾讯元宝的公开解析服务）
 *     → 返回 `data.playable_url`（channels 预览地址，query 里带 `token` 与 `eid`）
 *       以及 `data.desc / data.author / data.cover_url`
 *  ② `POST https://channels.weixin.qq.com/finder-preview/api/feed/get_feed_info?_rid=…&_pageUrl=…`
 *     body `{baseReq:{generalToken:token}, exportId:eid}`
 *     headers 需带 `Origin: https://channels.weixin.qq.com`、`Referer: <playable_url>`
 *     → 返回 `data.feedInfo.h264VideoInfo.videoUrl`（H.264，iOS 友好）等
 *
 * ⚠️ 401 / `error.code == 20000` 表示需要（有效的）腾讯系 Cookie；没配 Cookie 时先试一次，
 *    失败就把 `needLogin` 抛给上层提示用户去设置里填。
 */

import { fetch } from "scripting"

export interface WxChannelsResult {
  success: boolean
  platform?: string
  title?: string
  author?: string
  cover_url?: string | null
  video_url?: string | null
  videoUrls?: string[]
  durationSeconds?: number
  quality?: string
  link?: string
  error?: string
  debug?: string[]
  needLogin?: boolean
}

const UA_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"

const SHARE_URL = (id: string) => `https://weixin.qq.com/sph/${id}`
const YUANBAO_API = "https://yuanbao.tencent.com/api/weixin/get_parse_result"
const FEED_API = "https://channels.weixin.qq.com/finder-preview/api/feed/get_feed_info"
const FEED_PAGE = "https://channels.weixin.qq.com/finder-preview/pages/feed"

/** 从视频号分享链接里取 share id */
export function extractWxChannelsId(url: string): string | null {
  const patterns = [
    /weixin\.qq\.com\/sph\/([A-Za-z0-9_-]{6,})/,
    /channels\.weixin\.qq\.com\/finder-preview\/pages\/sph\?[^#]*?\bid=([A-Za-z0-9_-]{6,})/,
    /channels\.weixin\.qq\.com\/[^"'\s]*[?&]id=([A-Za-z0-9_-]{6,})/,
  ]
  for (const p of patterns) {
    const m = url.match(p)
    if (m?.[1]) return m[1]
  }
  return null
}

function randomRid(): string {
  const hex = (n: number) => Math.floor(Math.random() * n).toString(16).padStart(2, "0")
  let token = ""
  for (let i = 0; i < 16; i++) token += hex(256)
  return `${Math.floor(Date.now() / 1000).toString(16)}-${token.slice(0, 8)}`
}

function queryParam(url: string, key: string): string {
  const m = url.match(new RegExp(`[?&]${key}=([^&#]+)`))
  return m ? decodeURIComponent(m[1]) : ""
}

/**
 * 解析微信视频号视频（需分享链接；拿到的是 H.264 直链）。
 */
export async function parseWxChannels(url: string, cookie: string = ""): Promise<WxChannelsResult> {
  const debug: string[] = []
  const result: WxChannelsResult = { success: false, platform: "wxchannels", link: url, debug }

  const shareId = extractWxChannelsId(url)
  if (!shareId) {
    result.error = "无法从链接中提取视频号 ID（需要 weixin.qq.com/sph/xxx 形式的分享链接）"
    return result
  }
  debug.push(`视频号 ID：${shareId}${cookie ? " · 带 Cookie" : " · 未配置 Cookie"}`)

  // ① 用腾讯元宝的公开解析服务把分享链接换成 channels 预览地址
  let parseData: any = null
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": UA_IOS,
      Origin: "https://yuanbao.tencent.com",
      Referer: "https://yuanbao.tencent.com/",
    }
    if (cookie) headers["Cookie"] = cookie
    const resp = await fetch(YUANBAO_API, {
      method: "POST",
      headers,
      body: JSON.stringify({ type: "video_channel_url", url: SHARE_URL(shareId), scene: 1 }),
      timeout: 25,
    } as any)
    debug.push(`yuanbao 解析：HTTP ${resp.status}`)
    if (resp.status === 401) {
      result.needLogin = true
      result.error = "视频号解析需要腾讯系 Cookie（yuanbao.tencent.com 登录态）"
      return result
    }
    const json: any = await resp.json()
    if (json?.error) {
      const code = String(json.error.code ?? "")
      if (code === "20000") {
        result.needLogin = true
        result.error = "视频号解析需要有效的腾讯系 Cookie（当前 Cookie 无效或已过期）"
        return result
      }
      result.error = `视频号解析失败：${json.error.message || json.error.code || "未知错误"}`
      return result
    }
    if (json?.code !== 0) {
      result.error = `视频号解析失败：${json?.message || `code=${json?.code}`}`
      return result
    }
    parseData = json?.data || {}
  } catch (error) {
    result.error = `yuanbao 解析异常：${error instanceof Error ? error.message : String(error)}`
    return result
  }

  const playableUrl: string = parseData?.playable_url || ""
  if (!parseData?.wx_export_id || !playableUrl) {
    result.error = "视频号视频不存在或已删除"
    return result
  }
  const token = queryParam(playableUrl, "token")
  const exportId = queryParam(playableUrl, "eid")
  if (!token || !exportId) {
    result.error = "拿不到视频号播放凭据（token / eid）"
    return result
  }
  debug.push("已换取 channels 播放凭据")

  // ② 拿真正的视频地址（H.264 优先）
  try {
    const reqUrl = `${FEED_API}?_rid=${randomRid()}&_pageUrl=${encodeURIComponent(FEED_PAGE)}`
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": UA_IOS,
      Origin: "https://channels.weixin.qq.com",
      Referer: playableUrl,
    }
    if (cookie) headers["Cookie"] = cookie
    const resp = await fetch(reqUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ baseReq: { generalToken: token }, exportId }),
      timeout: 25,
    } as any)
    const json: any = await resp.json()
    const feedData = json?.data || {}
    const errText = [feedData?.errMsg?.title, feedData?.errMsg?.content]
      .filter(Boolean)
      .map((s: string) => String(s).replace(/<[^>]*>/g, "").trim())
      .filter(Boolean)
      .join(" ")
    if (json?.errCode !== 0 || errText) {
      result.error = `视频号接口返回：${errText || json?.errMsg || `errCode=${json?.errCode}`}`
      return result
    }
    const feedInfo = feedData?.feedInfo || {}
    const videoUrl = feedInfo?.h264VideoInfo?.videoUrl || feedInfo?.videoUrl || feedInfo?.h265VideoInfo?.videoUrl || ""
    if (!videoUrl) {
      result.error = "暂不支持该类型（没有拿到视频地址）"
      return result
    }
    result.video_url = videoUrl
    result.videoUrls = [videoUrl]
    result.quality = feedInfo?.h264VideoInfo?.videoUrl ? "H.264" : "默认"
    result.cover_url = feedInfo?.coverUrl || parseData?.cover_url || null
    result.title = feedInfo?.description || parseData?.desc || ""
    result.author = feedData?.authorInfo?.nickname || parseData?.author || ""
    if (typeof feedInfo?.videoPlayLen === "number" && feedInfo.videoPlayLen > 0) {
      result.durationSeconds = Math.round(feedInfo.videoPlayLen)
    } else if (typeof parseData?.duration === "number" && parseData.duration > 0) {
      result.durationSeconds = Math.round(parseData.duration)
    }
    result.success = true
    debug.push(`拿到视频直链（${result.quality}）`)
    return result
  } catch (error) {
    result.error = `视频号取流异常：${error instanceof Error ? error.message : String(error)}`
    return result
  }
}

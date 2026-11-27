import { fetch } from "scripting"
import type { Cloud115Config } from "./config"
import type { RemoteMedia } from "../types"

const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"

function headers(cookie: string): Record<string, string> {
  return {
    "User-Agent": UA,
    Cookie: cookie,
    Accept: "application/json, text/plain, */*",
    Referer: "https://115.com/",
  }
}

export async function cloud115Check(config: Cloud115Config): Promise<string> {
  if (!config.cookie.trim()) throw new Error("请填写 115 Cookie")

  const res2 = await fetch("https://webapi.115.com/files?offset=0&limit=1&show_dir=1", {
    headers: headers(config.cookie),
  })
  const data2 = await res2.json().catch(() => null)
  if (data2 && data2.state === true) return "Cookie 有效"
  throw new Error(data2?.error || data2?.msg || "Cookie 无效或已过期")
}

export async function cloud115ListVideos(
  config: Cloud115Config,
  cid = "0",
  limit = 50
): Promise<RemoteMedia[]> {
  if (!config.cookie.trim()) throw new Error("请先配置 115 Cookie")

  const res = await fetch(
    `https://webapi.115.com/files?aid=1&cid=${cid}&o=user_ptime&asc=0&offset=0&show_dir=1&limit=${limit}&code=&scid=&snap=0&natsort=1&source=&format=json`,
    { headers: headers(config.cookie) }
  )
  const data = await res.json()
  if (!data || data.state !== true) {
    throw new Error(data?.error || data?.msg || "115 文件列表获取失败")
  }

  const files = data.data || []
  const videos: RemoteMedia[] = []
  const videoExt = /\.(mp4|mkv|avi|mov|m3u8|ts|flv|wmv|m4v|webm|rmvb)$/i

  for (const f of files) {
    const name = f.n || f.file_name || ""
    const isDir = f.fc === 1 || f.pid === undefined && f.cid && !f.fid
    if (isDir) continue

    const isVideo =
      videoExt.test(name) ||
      String(f.class || "").toLowerCase().includes("video") ||
      String(f.ico || "").toLowerCase() === "avi"

    if (!isVideo) continue

    const pickCode = f.pc || f.pick_code
    if (!pickCode) continue

    videos.push({
      id: `115_${f.fid || pickCode}`,
      title: name || "未命名",
      url: "",
      sourceType: "115",
      sourceName: "115网盘",
      headers: { Cookie: config.cookie, Referer: "https://115.com/", "User-Agent": UA },
      extra: { pickCode, fid: f.fid },
    })
  }

  return videos
}

export async function cloud115GetPlayUrl(
  config: Cloud115Config,
  pickCode: string
): Promise<{ url: string; headers: Record<string, string> }> {
  if (!config.cookie.trim()) throw new Error("请先配置 115 Cookie")
  if (!pickCode) throw new Error("缺少 pickCode")

  const h = headers(config.cookie)

  const res = await fetch(
    `https://proapi.115.com/app/chrome/downurl?pickcode=${encodeURIComponent(pickCode)}`,
    { headers: h }
  )
  const data = await res.json().catch(() => null)

  let url: string | null =
    data?.data?.[pickCode]?.url?.url ||
    data?.data?.url?.url ||
    data?.data?.url ||
    data?.url ||
    null

  if (!url) {
    const res2 = await fetch("https://webapi.115.com/files/download", {
      method: "POST",
      headers: {
        ...h,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `pick_code=${encodeURIComponent(pickCode)}`,
    })
    const data2 = await res2.json().catch(() => null)
    url = data2?.data?.url || data2?.url || null
    if (!url) {
      throw new Error(data?.error || data2?.error || "无法获取 115 播放直链，请检查 Cookie 权限")
    }
  }

  return {
    url,
    headers: {
      Cookie: config.cookie,
      Referer: "https://115.com/",
      "User-Agent": UA,
    },
  }
}

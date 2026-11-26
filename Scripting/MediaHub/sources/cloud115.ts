import type { Cloud115Config } from "./config"

export interface RemoteMedia {
  id: string
  title: string
  url: string
  poster?: string
  sourceType: "115"
  sourceName: string
  extra?: Record<string, any>
}

const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"

function headers(cookie: string) {
  return {
    "User-Agent": UA,
    Cookie: cookie,
    Accept: "application/json, text/plain, */*",
  }
}

/** 校验 Cookie 是否有效 */
export async function cloud115Check(config: Cloud115Config): Promise<string> {
  if (!config.cookie.trim()) throw new Error("请填写 115 Cookie")
  const res = await fetch("https://my.115.com/?ct=ajax&ac=nav", {
    headers: headers(config.cookie),
  })
  const data = await res.json().catch(() => null)
  if (data && (data.state === true || data.user_id || data.data)) {
    return "Cookie 有效"
  }
  // 备选校验
  const res2 = await fetch("https://webapi.115.com/files?offset=0&limit=1&show_dir=1", {
    headers: headers(config.cookie),
  })
  const data2 = await res2.json().catch(() => null)
  if (data2 && data2.state === true) return "Cookie 有效"
  throw new Error(data2?.error || data?.error || "Cookie 无效或已过期")
}

/** 列出视频文件（简化：根目录与一级文件夹中的视频） */
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
    throw new Error(data?.error || "115 文件列表获取失败")
  }

  const files = data.data || []
  const videos: RemoteMedia[] = []

  for (const f of files) {
    // 文件夹跳过；也可递归，这里先只取视频文件
    const isVideo =
      f.fc === 0 &&
      (String(f.class || "").includes("video") ||
        /\.(mp4|mkv|avi|mov|m3u8|ts|flv|wmv|m4v)$/i.test(f.n || ""))

    if (!isVideo) continue

    const pickCode = f.pc || f.pick_code
    if (!pickCode) continue

    videos.push({
      id: `115_${f.fid || pickCode}`,
      title: f.n || "未命名",
      url: "",
      sourceType: "115",
      sourceName: "115网盘",
      extra: { pickCode, fid: f.fid },
    })
  }

  return videos
}

/** 根据 pickcode 获取直链 */
export async function cloud115GetPlayUrl(
  config: Cloud115Config,
  pickCode: string
): Promise<string> {
  if (!config.cookie.trim()) throw new Error("请先配置 115 Cookie")

  // 使用 115 下载/播放接口（可能随官方变更）
  const res = await fetch(
    `https://proapi.115.com/app/chrome/downurl?pickcode=${encodeURIComponent(pickCode)}`,
    { headers: headers(config.cookie) }
  )
  const data = await res.json().catch(() => null)

  // 兼容多种返回结构
  const url =
    data?.data?.[pickCode]?.url?.url ||
    data?.data?.url ||
    data?.url ||
    null

  if (url) return url

  // 备用：webapi files download
  const res2 = await fetch("https://webapi.115.com/files/download", {
    method: "POST",
    headers: {
      ...headers(config.cookie),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `pick_code=${encodeURIComponent(pickCode)}`,
  })
  const data2 = await res2.json().catch(() => null)
  const url2 = data2?.data?.url || data2?.url
  if (url2) return url2

  throw new Error(data?.error || data2?.error || "无法获取 115 播放直链，请检查 Cookie 权限")
}

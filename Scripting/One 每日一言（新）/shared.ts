// ONE 每日一言 —— 数据层（App 与小组件共用）
// ---------------------------------------------------------------------------
// 缓存都落在 App Group 目录，App 进程与小组件进程都能读写：
//   one_data.json  文本缓存（正文、作者、数据日期、最后一次成功拉取时间、文字配色）
//   one_bg.jpg     配图缩略图（按小组件尺寸降采样后的 JPEG）
//   one_log.txt    运行日志（每次运行的时间 / 来源 / 结果），用于排查刷新问题
//
// 设计要点：
// 1. 每日一言一天只有一条内容，所以缓存以“数据日期”为准：只有跨天、没有缓存或上一次
//    拉取失败时才联网。小组件在后台的运行次数因此压到每天 1 次左右，不会因为频繁请求
//    被 iOS 削减刷新预算（后台刷新被系统忽略时，小组件会一直停在旧内容上）。
// 2. 拉取失败绝不覆盖旧缓存：继续显示上一次的内容，20 分钟后重试。
// 3. JSON 缓存里不存 base64 图片 —— 旧版把整张图的 base64 写进了 meta 文件，
//    单文件 400 KB，小组件每次运行都要读出来 JSON.parse 一遍。
import { Device, fetch } from "scripting"

export const WORKER = "https://one.1314k.eu.org/daily"

const CACHE_VERSION = 2

/** 缩略图基准尺寸（systemLarge 在 iPhone 上的点尺寸），乘屏幕倍率得到像素 */
const THUMBNAIL_BOX = { width: 360, height: 376 }

/** 服务器在本地时间 00:01 推送当天内容，00:05 之后再来取更稳 */
const PUBLISH_MINUTE = 5

/** 当天内容还没发布 / 网络失败时的重试间隔 */
const RETRY_DELAY_MS = 20 * 60 * 1000

/** 运行日志最多保留的行数 */
const MAX_LOG_LINES = 60

const DIR = FileManager.appGroupDocumentsDirectory
export const DATA_PATH = `${DIR}/one_data.json`
export const IMAGE_PATH = `${DIR}/one_bg.jpg`
export const LOG_PATH = `${DIR}/one_log.txt`

const LIGHT_TEXT = { mainColor: "rgba(0,0,0,0.88)", subColor: "rgba(0,0,0,0.56)" }
const DARK_TEXT = { mainColor: "rgba(255,255,255,0.92)", subColor: "rgba(255,255,255,0.62)" }

export type Article = { author: string; desc: string; image: string }

export type Content = {
  v: number
  /** 内容对应的本地日期，如 2026-09-26 */
  dataDate: string
  /** 最后一次成功拉取的时间戳 */
  fetchedAt: number
  author: string
  desc: string
  mainColor: string
  subColor: string
}

export type RefreshResult = {
  content: Content | null
  /** 本次是否真的联网取回了新内容 */
  fetched: boolean
  error?: string
}

function pad(n: number): string {
  return String(n).padStart(2, "0")
}

/** 设备本地日期（设备时区即北京时间） */
export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 形如 09-26 00:05，用在“更新”标签上 */
export function formatStamp(timestamp: number): string {
  const date = new Date(timestamp)
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 下一次可能拿到新内容的时刻：本地次日 00:05 */
function nextPublishDate(from: Date): Date {
  const date = new Date(from)
  date.setDate(date.getDate() + 1)
  date.setHours(0, PUBLISH_MINUTE, 0, 0)
  return date
}

/**
 * 小组件下一次向系统请求新时间线的时刻。
 * - 当天内容已就位：次日 00:05（每天只请求一次，请求时间紧跟服务器发布）
 * - 还没就位（未发布 / 网络失败 / 无任何缓存）：20 分钟后重试
 */
export function nextReloadDate(result: RefreshResult): Date {
  const now = new Date()
  const upToDate = !!result.content && !result.error && result.content.dataDate === localDate(now)
  return upToDate ? nextPublishDate(now) : new Date(now.getTime() + RETRY_DELAY_MS)
}

/**
 * 传给 Widget.present 的第二个参数。
 * Scripting 同时声明了 present(node, reloadPolicy) 和 present(node, options) 两种重载，
 * 两者的字段名不同（policy/date 与 reloadPolicy）。这里一次给出两种形态，
 * 避免其中一种被忽略后退回默认的 atEnd 策略 —— 那样小组件会在长时间里不再刷新。
 */
export function reloadPolicyArgument(date: Date): any {
  return {
    policy: "after",
    date,
    reloadPolicy: { policy: "after", date },
  }
}

/** 追加一行运行日志，写失败不影响主流程 */
export async function appendLog(text: string): Promise<void> {
  try {
    const now = new Date()
    const line = `${localDate(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())} ${text}`
    let lines: string[] = []
    if (FileManager.existsSync(LOG_PATH)) {
      const raw = await FileManager.readAsString(LOG_PATH)
      lines = raw.split("\n").filter(l => l.trim().length > 0)
    }
    lines.push(line)
    if (lines.length > MAX_LOG_LINES) lines = lines.slice(-MAX_LOG_LINES)
    await FileManager.writeAsString(LOG_PATH, lines.join("\n") + "\n")
  } catch {
    // 忽略
  }
}

async function removeIfExists(path: string): Promise<void> {
  try {
    if (FileManager.existsSync(path)) await FileManager.remove(path)
  } catch {
    // 忽略
  }
}

/** 向 Worker 取指定日期的内容 */
export async function fetchArticle(date: string): Promise<Article> {
  const response = await fetch(`${WORKER}?date=${date}`)
  if (!response.ok) throw new Error(`请求失败（${response.status}）`)
  const data = JSON.parse(await response.text())
  if (data?.error) throw new Error(String(data.error))

  const desc = String(data?.desc ?? "").trim()
  if (!desc) throw new Error("返回内容为空")

  // Worker 的 date 是内容实际对应的日期：跨天时当天内容还没发布，
  // 这时强取回来的其实是旧数据，标成失败让调用方稍后重试。
  const dataDate = String(data?.date ?? "").slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(dataDate) && dataDate !== date) {
    throw new Error(`当天内容尚未发布（服务器为 ${dataDate}）`)
  }

  return {
    author: String(data?.author ?? "").trim(),
    desc,
    image: String(data?.image ?? ""),
  }
}

/** 读取文本缓存，坏文件当作没有缓存 */
export async function readContent(): Promise<Content | null> {
  if (!FileManager.existsSync(DATA_PATH)) return null
  try {
    const parsed = JSON.parse(await FileManager.readAsString(DATA_PATH)) as Content
    return parsed?.desc ? parsed : null
  } catch {
    return null
  }
}

function textColors(image: UIImage): { mainColor: string; subColor: string } {
  const color = image.averageColor()
  if (!color) return DARK_TEXT
  const brightness = 0.2126 * color.red + 0.7152 * color.green + 0.0722 * color.blue
  return brightness > 0.6 ? LIGHT_TEXT : DARK_TEXT
}

/**
 * 把配图存成缩略图并算出文字配色。
 * preparingThumbnail 走 ImageIO 降采样，不会把 1537×2048 的原图整张解码进内存
 * （小组件扩展的内存上限只有 30 MB 左右）。
 */
async function saveThumbnail(article: Article): Promise<{ mainColor: string; subColor: string }> {
  if (!article.image) {
    await removeIfExists(IMAGE_PATH)
    return DARK_TEXT
  }
  const base64 = article.image.includes(",") ? article.image.split(",")[1] : article.image
  const raw = Data.fromBase64String(base64)
  const image = raw ? UIImage.fromData(raw) : null
  if (!image) {
    await removeIfExists(IMAGE_PATH)
    return DARK_TEXT
  }

  const scale = Device.screen.scale
  const thumbnail = image.preparingThumbnail({
    width: Math.round(THUMBNAIL_BOX.width * scale),
    height: Math.round(THUMBNAIL_BOX.height * scale),
  }) ?? image

  const jpeg = thumbnail.toJPEGData(0.8)
  if (jpeg) await FileManager.writeAsData(IMAGE_PATH, jpeg)
  else await removeIfExists(IMAGE_PATH)

  return textColors(thumbnail)
}

/**
 * 拿到可用于渲染的内容：能命中当天缓存就不再联网，否则拉取一次。
 * 拉取失败时返回上一次成功的内容（`error` 里带原因），调用方据此安排重试。
 */
export async function refreshContent(opts: { force?: boolean; source?: string } = {}): Promise<RefreshResult> {
  const source = opts.source ?? "app"
  const today = localDate()
  const cached = await readContent()
  const upToDate = !!cached && cached.dataDate === today && FileManager.existsSync(IMAGE_PATH)

  if (!opts.force && upToDate) {
    await appendLog(`${source} 命中当日缓存（${today}）`)
    return { content: cached, fetched: false }
  }

  try {
    const article = await fetchArticle(today)
    const colors = await saveThumbnail(article)
    const content: Content = {
      v: CACHE_VERSION,
      dataDate: today,
      fetchedAt: Date.now(),
      author: article.author,
      desc: article.desc,
      mainColor: colors.mainColor,
      subColor: colors.subColor,
    }
    await FileManager.writeAsString(DATA_PATH, JSON.stringify(content))
    await appendLog(`${source} 更新成功 ${today}｜${article.desc.slice(0, 10)}`)
    return { content, fetched: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await appendLog(`${source} 更新失败：${message}`)
    return { content: cached, fetched: false, error: message }
  }
}

/** 清理旧版按天存放的缓存文件（one_bg_*.jpg / one_meta_*.json / one_preview_bg.jpg） */
export async function cleanupLegacyFiles(): Promise<number> {
  let removed = 0
  try {
    for (const name of FileManager.readDirectorySync(DIR)) {
      const legacy = /^one_(bg|meta)_\d{4}-\d{2}-\d{2}\.(jpg|json)$/.test(name) || name === "one_preview_bg.jpg"
      if (!legacy) continue
      await removeIfExists(`${DIR}/${name}`)
      removed++
    }
  } catch {
    // 忽略
  }
  return removed
}

/**
 * 分块下载工具
 *
 * 为什么要分块：B 站等站点的 CDN 里混着大量 **PCDN 节点**（`*.mountaintoys.cn:4483`、
 * `*.mcdn.bilivideo.cn:8082`），实测「头几 MB 很快、之后长连接直接卡死」——
 * 一次整包 fetch 就会卡到超时（真机实测：3 分半的视频下 7 分钟没下完）。
 * 分块（Range）+ 每块重试能把这种抖动限制在单块内。
 *
 * 每块**直接落盘**再拼接（用 `cat`），而不是在 JS 里累加成一个超大 Data：
 * 长视频动辄几百 MB，全放内存既慢又容易被系统杀掉。
 */

import { fetch } from "scripting"

export interface DownloadOptions {
  headers?: Record<string, string>
  /** 进度回调（已下载字节 / 总字节，总字节未知时为 0） */
  onProgress?: (downloaded: number, total: number) => void
  /** 单块大小，默认 4MB */
  chunkSize?: number
  /** 单块重试次数，默认 3 */
  retries?: number
  /** 单次请求超时（秒），默认 60 */
  timeoutSeconds?: number
  /** 分块阈值：文件小于它就直接整包下载（默认 8MB） */
  directThreshold?: number
}

export interface DownloadResult {
  ok: boolean
  bytes: number
  note: string
}

const DEFAULT_CHUNK = 4 * 1024 * 1024

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(() => resolve(), ms))
}

/** 取远端文件大小（HEAD → Range 探测兜底） */
async function remoteSize(url: string, headers: Record<string, string>, timeoutSeconds: number): Promise<number> {
  try {
    const head = await fetch(url, { method: "HEAD", headers, timeout: timeoutSeconds } as any)
    if (head.ok) {
      const len = (head.headers as any)?.get?.("Content-Length") || (head.headers as any)?.get?.("content-length")
      const size = len ? parseInt(String(len), 10) : 0
      if (size > 0) return size
    }
  } catch {}
  try {
    const probe = await fetch(url, { headers: { ...headers, Range: "bytes=0-0" }, timeout: timeoutSeconds } as any)
    const cr = (probe.headers as any)?.get?.("Content-Range") || ""
    const m = String(cr).match(/\/(\d+)\s*$/)
    if (m) return parseInt(m[1], 10)
    const len = (probe.headers as any)?.get?.("Content-Length")
    if (len) return parseInt(String(len), 10)
  } catch {}
  return 0
}

/**
 * 下载到文件（分块 → 逐块落盘 → `cat` 拼接 → 清理分片）。
 * 返回真实写出的文件字节数。
 */
export async function downloadToFile(
  url: string,
  path: string,
  options: DownloadOptions = {}
): Promise<DownloadResult> {
  const headers = options.headers || {}
  const chunkSize = options.chunkSize || DEFAULT_CHUNK
  const retries = options.retries ?? 3
  const timeoutSeconds = options.timeoutSeconds ?? 60
  const directThreshold = options.directThreshold ?? 8 * 1024 * 1024
  const progress = options.onProgress || (() => {})

  const cleanup = async (paths: string[]) => {
    for (const p of paths) {
      try { if (await FileManager.exists(p)) await FileManager.remove(p) } catch {}
    }
  }

  const total = await remoteSize(url, headers, timeoutSeconds)

  // 小文件 / 拿不到大小 → 直接整包
  if (!total || total <= directThreshold) {
    try {
      const resp = await fetch(url, { headers, timeout: Math.max(timeoutSeconds, 120) } as any)
      if (!resp.ok) return { ok: false, bytes: 0, note: `HTTP ${resp.status}` }
      // ⚠️ FileManager.writeAsBytes 要的是 bytes(Uint8Array)，不是 Data
      const bytes = await (resp as any).bytes()
      const size = (bytes as any)?.byteLength || 0
      if (!bytes || size === 0) return { ok: false, bytes: 0, note: "下载数据为空" }
      if (await FileManager.exists(path)) await FileManager.remove(path)
      await FileManager.writeAsBytes(path, bytes)
      progress(size, size)
      return { ok: true, bytes: size, note: "整包下载" }
    } catch (error) {
      return { ok: false, bytes: 0, note: `下载失败：${error instanceof Error ? error.message : String(error)}` }
    }
  }

  // 分块下载
  const parts: string[] = []
  let downloaded = 0
  let offset = 0
  while (offset < total) {
    const end = Math.min(offset + chunkSize - 1, total - 1)
    const partPath = `${path}.part${parts.length}`
    let ok = false
    let lastError = ""
    for (let attempt = 1; attempt <= retries && !ok; attempt++) {
      try {
        const resp = await fetch(url, {
          headers: { ...headers, Range: `bytes=${offset}-${end}` },
          timeout: timeoutSeconds,
        } as any)
        if (resp.status !== 206) {
          lastError = `HTTP ${resp.status}（不支持 Range）`
          if (attempt === retries) {
            await cleanup(parts)
            return { ok: false, bytes: 0, note: lastError }
          }
          await sleep(300 * attempt)
          continue
        }
        const bytes = await (resp as any).bytes()
        const size = (bytes as any)?.byteLength || 0
        if (!bytes || size === 0) {
          lastError = "分块返回空数据"
          await sleep(300 * attempt)
          continue
        }
        if (await FileManager.exists(partPath)) await FileManager.remove(partPath)
        await FileManager.writeAsBytes(partPath, bytes)
        parts.push(partPath)
        downloaded += size
        offset += size
        progress(downloaded, total)
        ok = true
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
        await sleep(400 * attempt)
      }
    }
    if (!ok) {
      await cleanup(parts)
      return { ok: false, bytes: downloaded, note: `分块下载失败（第 ${parts.length + 1} 块）：${lastError}` }
    }
  }

  // 拼接：cat 分片 > 目标文件（ios_system 支持重定向）
  const list = parts.map((p) => `"${p}"`).join(" ")
  const merged = await Shell.run(`cat ${list} > "${path}"`, { timeout: 300 })
  const ok = merged.exitCode === 0 && (await FileManager.exists(path))
  if (!ok) {
    await cleanup(parts)
    return { ok: false, bytes: downloaded, note: `拼接失败：${(merged.output || "").slice(0, 150)}` }
  }
  await cleanup(parts)
  return { ok: true, bytes: downloaded, note: `分块下载（${parts.length} 块）` }
}

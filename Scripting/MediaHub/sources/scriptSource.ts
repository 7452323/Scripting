import { fetch } from "scripting"
import type { ScriptSourceConfig } from "./config"
import type { RemoteMedia } from "../types"

/**
 * 脚本源约定：
 * - JS：定义 main(query) / getList(query)，返回 { list: [{ title, url, poster? }] } 或数组
 * - 也可直接是 JSON 文件
 * - Python：定义 main(q)/get_list(q)，环境支持时执行
 */
export async function loadScriptSource(
  source: ScriptSourceConfig,
  query?: string
): Promise<RemoteMedia[]> {
  if (!source.url) throw new Error("脚本源地址为空")

  const code = await fetchSourceText(source.url)

  // 纯 JSON 源
  const trimmed = code.trim()
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return normalizeList(source, JSON.parse(trimmed))
    } catch {
      // 继续当脚本执行
    }
  }

  if (source.type === "py") {
    return runPythonSource(source, code, query)
  }
  return runJsSource(source, code, query)
}

async function fetchSourceText(url: string): Promise<string> {
  if (/^https?:\/\//i.test(url)) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`下载脚本失败 (${res.status})`)
    return await res.text()
  }

  const path = url.startsWith("file://") ? url.slice("file://".length) : url

  try {
    if (typeof FileManager !== "undefined") {
      const fm: any = FileManager
      if (typeof fm.readAsString === "function") {
        const s = await Promise.resolve(fm.readAsString(path))
        if (s) return s
      }
      if (typeof fm.readString === "function") {
        const s = await Promise.resolve(fm.readString(path))
        if (s) return s
      }
      if (typeof fm.read === "function") {
        const s = await Promise.resolve(fm.read(path))
        if (typeof s === "string" && s) return s
      }
    }
  } catch (e) {
    console.warn("FileManager 读取失败，尝试 fetch", e)
  }

  const fileUrl = path.startsWith("/") ? `file://${path}` : path
  const res = await fetch(fileUrl)
  if (!res.ok) throw new Error(`读取本地脚本失败 (${res.status})`)
  return await res.text()
}

async function runJsSource(
  source: ScriptSourceConfig,
  code: string,
  query?: string
): Promise<RemoteMedia[]> {
  const runner = new Function(
    "query",
    "fetch",
    "console",
    `
    "use strict";
    var module = { exports: {} };
    var exports = module.exports;
    var result;
    ${code}
    if (typeof main === "function") return main(query);
    if (typeof getList === "function") return getList(query);
    if (module.exports && (module.exports.list || Array.isArray(module.exports) || typeof module.exports === "function")) {
      if (typeof module.exports === "function") return module.exports(query);
      return module.exports;
    }
    if (typeof result !== "undefined") return result;
    return null;
  `
  )

  let out: any
  try {
    out = await Promise.resolve(runner(query || "", fetch, console))
  } catch (e: any) {
    throw new Error(`脚本执行失败: ${e?.message || e}`)
  }
  return normalizeList(source, out)
}

async function runPythonSource(
  source: ScriptSourceConfig,
  code: string,
  query?: string
): Promise<RemoteMedia[]> {
  const py = (globalThis as any).Python
  if (!py) {
    throw new Error("当前环境未启用 Python，请改用 JS 脚本源或 JSON 源")
  }

  const wrapped =
    code +
    `

import json
q = ${JSON.stringify(query || "")}
out = None
if "main" in globals() and callable(main):
    out = main(q)
elif "get_list" in globals() and callable(get_list):
    out = get_list(q)
print("__MEDIAHUB_JSON__" + json.dumps(out, ensure_ascii=False))
`

  let stdout = ""
  if (typeof py.run === "function") {
    stdout = String(await py.run(wrapped))
  } else if (typeof py.eval === "function") {
    stdout = String(await py.eval(wrapped))
  } else {
    throw new Error("Python API 不可用")
  }

  const marker = "__MEDIAHUB_JSON__"
  const idx = stdout.lastIndexOf(marker)
  if (idx === -1) throw new Error("Python 脚本未输出结果 JSON")
  const jsonText = stdout.slice(idx + marker.length).trim()
  return normalizeList(source, JSON.parse(jsonText))
}

function normalizeList(source: ScriptSourceConfig, result: any): RemoteMedia[] {
  if (result == null) throw new Error("脚本未返回数据")

  let list: any[] = []
  if (Array.isArray(result)) list = result
  else if (Array.isArray(result.list)) list = result.list
  else if (Array.isArray(result.data)) list = result.data
  else throw new Error("脚本未返回 list 数组")

  return list
    .filter(item => item && (item.url || item.playUrl || item.play_url))
    .map((item, index) => ({
      id: `script_${source.id}_${item.id || index}`,
      title: String(item.title || item.name || `条目 ${index + 1}`),
      url: String(item.url || item.playUrl || item.play_url),
      poster: item.poster || item.cover || item.pic,
      sourceType: "script" as const,
      sourceName: source.name || "脚本源",
      headers: item.headers && typeof item.headers === "object" ? item.headers : undefined,
      extra: item,
    }))
}

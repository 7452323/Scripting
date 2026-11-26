import type { ScriptSourceConfig } from "./config"

export interface RemoteMedia {
  id: string
  title: string
  url: string
  poster?: string
  sourceType: "script"
  sourceName: string
  extra?: Record<string, any>
}

/**
 * 脚本源约定（JS）：
 * 远程/本地脚本应导出或返回 JSON：
 * {
 *   list: [{ title, url, poster? }]
 * }
 * 或数组本身。
 *
 * Python 源：执行后 stdout 打印同样结构的 JSON。
 */
export async function loadScriptSource(
  source: ScriptSourceConfig,
  query?: string
): Promise<RemoteMedia[]> {
  if (!source.url) throw new Error("脚本源地址为空")

  let code = ""
  if (/^https?:\/\//i.test(source.url)) {
    const res = await fetch(source.url)
    if (!res.ok) throw new Error(`下载脚本失败 (${res.status})`)
    code = await res.text()
  } else {
    // 本地路径
    const path = source.url.startsWith("file://") ? source.url.replace(/^file:\/\//, "") : source.url
    const data = FileManager.readAsString?.(path) || (await (FileManager as any).readString?.(path))
    if (!data) {
      // 兼容同步/异步 API
      const raw = await fetch(path.startsWith("/") ? `file://${path}` : path)
      code = await raw.text()
    } else {
      code = data
    }
  }

  if (source.type === "py") {
    return runPythonSource(source, code, query)
  }
  return runJsSource(source, code, query)
}

async function runJsSource(
  source: ScriptSourceConfig,
  code: string,
  query?: string
): Promise<RemoteMedia[]> {
  // 在受控函数中执行，要求脚本定义 main 或默认返回 list
  const runner = new Function(
    "query",
    "fetch",
    `
    "use strict";
    ${code}
    if (typeof main === "function") return main(query);
    if (typeof getList === "function") return getList(query);
    if (typeof module !== "undefined" && module.exports) return module.exports;
    if (typeof result !== "undefined") return result;
    return null;
  `
  )

  let result: any
  try {
    result = await Promise.resolve(runner(query || "", fetch))
  } catch (e: any) {
    throw new Error(`脚本执行失败: ${e?.message || e}`)
  }

  return normalizeList(source, result)
}

async function runPythonSource(
  source: ScriptSourceConfig,
  code: string,
  query?: string
): Promise<RemoteMedia[]> {
  // Scripting Python 桥：若环境支持 Python.eval / Python.run
  const py = (globalThis as any).Python
  if (!py) {
    throw new Error("当前环境未启用 Python，请改用 JS 脚本源")
  }

  const wrapped =
    code +
    `

import json
q = ${JSON.stringify(query || "")}
out = None
if "main" in dir():
    out = main(q)
elif "get_list" in dir():
    out = get_list(q)
print(json.dumps(out, ensure_ascii=False))
`

  let stdout = ""
  if (typeof py.run === "function") {
    stdout = String(await py.run(wrapped))
  } else if (typeof py.eval === "function") {
    stdout = String(await py.eval(wrapped))
  } else {
    throw new Error("Python API 不可用")
  }

  const lines = stdout.trim().split("\n")
  const last = lines[lines.length - 1]
  const parsed = JSON.parse(last)
  return normalizeList(source, parsed)
}

function normalizeList(source: ScriptSourceConfig, result: any): RemoteMedia[] {
  let list: any[] = []
  if (Array.isArray(result)) list = result
  else if (result && Array.isArray(result.list)) list = result.list
  else if (result && Array.isArray(result.data)) list = result.data
  else throw new Error("脚本未返回 list 数组")

  return list
    .filter(item => item && (item.url || item.playUrl))
    .map((item, index) => ({
      id: `script_${source.id}_${item.id || index}`,
      title: item.title || item.name || `条目 ${index + 1}`,
      url: item.url || item.playUrl,
      poster: item.poster || item.cover || item.pic,
      sourceType: "script" as const,
      sourceName: source.name || "脚本源",
      extra: item,
    }))
}

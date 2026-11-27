/** 各媒体源的配置读写 */

export type UrlScheme = "http" | "https"

export interface EmbyConfig {
  enabled: boolean
  scheme: UrlScheme
  host: string
  port: string
  /** 兼容旧字段，由 scheme/host/port 生成 */
  server: string
  username: string
  password: string
  accessToken?: string
  userId?: string
}

export interface PlexConfig {
  enabled: boolean
  scheme: UrlScheme
  host: string
  port: string
  server: string
  token: string
}

export interface Cloud115Config {
  enabled: boolean
  cookie: string
  /** 空间信息缓存 */
  spaceUsed?: number
  spaceTotal?: number
}

export interface ScriptSourceConfig {
  id: string
  name: string
  url: string
  enabled: boolean
  type: "js" | "py"
}

export interface SourcesConfig {
  emby: EmbyConfig
  plex: PlexConfig
  cloud115: Cloud115Config
  scripts: ScriptSourceConfig[]
  tmdbApiKey: string
}

const KEY = "mediahub.sources"

const defaults: SourcesConfig = {
  emby: {
    enabled: false,
    scheme: "https",
    host: "",
    port: "8096",
    server: "",
    username: "",
    password: "",
  },
  plex: {
    enabled: false,
    scheme: "http",
    host: "",
    port: "32400",
    server: "",
    token: "",
  },
  cloud115: { enabled: false, cookie: "" },
  scripts: [],
  tmdbApiKey: "",
}

export function buildServerUrl(scheme: UrlScheme, host: string, port: string): string {
  let h = (host || "").trim()
  h = h.replace(/^https?:\/\//i, "").replace(/\/$/, "")
  // host 里若已带端口则拆开
  const m = h.match(/^([^/:]+):(\d+)$/)
  if (m) {
    h = m[1]
    if (!port) port = m[2]
  }
  const p = (port || "").trim()
  if (!h) return ""
  return p ? `${scheme}://${h}:${p}` : `${scheme}://${h}`
}

export function parseServerUrl(server: string): { scheme: UrlScheme; host: string; port: string } {
  const s = (server || "").trim()
  if (!s) return { scheme: "https", host: "", port: "" }
  try {
    const withScheme = /^https?:\/\//i.test(s) ? s : `http://${s}`
    const u = new URL(withScheme)
    const scheme = u.protocol === "https:" ? "https" : "http"
    const port = u.port || ""
    return { scheme, host: u.hostname, port }
  } catch {
    return { scheme: "https", host: s.replace(/^https?:\/\//i, ""), port: "" }
  }
}

function normalizeEmby(raw: any): EmbyConfig {
  const base = { ...defaults.emby, ...(raw || {}) }
  if ((!base.host || !base.port) && base.server) {
    const p = parseServerUrl(base.server)
    base.scheme = base.scheme || p.scheme
    base.host = base.host || p.host
    base.port = base.port || p.port || "8096"
  }
  base.server = buildServerUrl(base.scheme || "https", base.host || "", base.port || "")
  return base
}

function normalizePlex(raw: any): PlexConfig {
  const base = { ...defaults.plex, ...(raw || {}) }
  if ((!base.host || !base.port) && base.server) {
    const p = parseServerUrl(base.server)
    base.scheme = base.scheme || p.scheme
    base.host = base.host || p.host
    base.port = base.port || p.port || "32400"
  }
  base.server = buildServerUrl(base.scheme || "http", base.host || "", base.port || "")
  return base
}

function parse(raw: unknown): SourcesConfig {
  if (raw == null) {
    return {
      emby: { ...defaults.emby },
      plex: { ...defaults.plex },
      cloud115: { ...defaults.cloud115 },
      scripts: [],
      tmdbApiKey: "",
    }
  }
  let obj: any = raw
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw)
    } catch {
      return parse(null)
    }
  }
  return {
    emby: normalizeEmby(obj.emby),
    plex: normalizePlex(obj.plex),
    cloud115: { ...defaults.cloud115, ...(obj.cloud115 || {}) },
    scripts: Array.isArray(obj.scripts) ? obj.scripts : [],
    tmdbApiKey: obj.tmdbApiKey || "",
  }
}

export function loadSourcesConfig(): SourcesConfig {
  try {
    return parse(Storage.get(KEY))
  } catch {
    return parse(null)
  }
}

export function saveSourcesConfig(config: SourcesConfig): void {
  // 保存前同步 server 字段
  config.emby.server = buildServerUrl(config.emby.scheme, config.emby.host, config.emby.port)
  config.plex.server = buildServerUrl(config.plex.scheme, config.plex.host, config.plex.port)
  Storage.set(KEY, JSON.stringify(config))
}

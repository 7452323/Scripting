/** 各媒体源的配置读写 */

export type UrlScheme = "http" | "https"

/** 首页展示哪个媒体库 */
export type HomeSource = "emby" | "plex" | "115"

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
  /** 首页当前展示的媒体库（长按首页可切换） */
  homeSource: HomeSource
}

const KEY = "mediahub.sources"
/** 115 Cookie 单独存一份：任何「整体写回配置」都不会把登录态抹掉 */
const COOKIE_KEY = "mediahub.115.cookie"

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
  homeSource: "emby",
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
      homeSource: "emby",
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
    homeSource:
      obj.homeSource === "plex" || obj.homeSource === "115" ? obj.homeSource : "emby",
  }
}

export function loadSourcesConfig(): SourcesConfig {
  let cfg: SourcesConfig
  try {
    cfg = parse(Storage.get(KEY))
  } catch {
    cfg = parse(null)
  }
  // Cookie 以独立 key 为准（非空时优先）
  try {
    const saved = Storage.get<string>(COOKIE_KEY)
    if (typeof saved === "string" && saved.trim()) {
      cfg.cloud115.cookie = saved.trim()
      if (!cfg.cloud115.enabled) cfg.cloud115.enabled = true
    }
  } catch {}
  return cfg
}

export function saveSourcesConfig(config: SourcesConfig): void {
  // 保存前同步 server 字段
  config.emby.server = buildServerUrl(config.emby.scheme, config.emby.host, config.emby.port)
  config.plex.server = buildServerUrl(config.plex.scheme, config.plex.host, config.plex.port)

  const cookie = (config.cloud115?.cookie || "").trim()
  if (cookie) {
    try {
      Storage.set(COOKIE_KEY, cookie)
    } catch {}
  } else {
    // 本次写入没带 Cookie（比如只改了空间缓存/首页来源）：把已存的补回来，绝不抹掉登录态
    try {
      const saved = Storage.get<string>(COOKIE_KEY)
      if (typeof saved === "string" && saved.trim()) config.cloud115.cookie = saved.trim()
    } catch {}
  }

  Storage.set(KEY, JSON.stringify(config))
}

/** 显式退出 115 登录（只有这里会真的清掉 Cookie） */
export function clearCloud115Cookie(): void {
  try {
    Storage.remove(COOKIE_KEY)
  } catch {}
  const cfg = loadSourcesConfig()
  cfg.cloud115.cookie = ""
  cfg.cloud115.enabled = false
  cfg.cloud115.spaceUsed = 0
  cfg.cloud115.spaceTotal = 0
  Storage.set(KEY, JSON.stringify(cfg))
}

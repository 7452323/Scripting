/** 各媒体源的配置读写 */

export interface EmbyConfig {
  enabled: boolean
  server: string
  username: string
  password: string
  accessToken?: string
  userId?: string
}

export interface PlexConfig {
  enabled: boolean
  server: string
  token: string
}

export interface Cloud115Config {
  enabled: boolean
  cookie: string
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
  emby: { enabled: false, server: "", username: "", password: "" },
  plex: { enabled: false, server: "", token: "" },
  cloud115: { enabled: false, cookie: "" },
  scripts: [],
  tmdbApiKey: "",
}

function parse(raw: unknown): SourcesConfig {
  if (raw == null) return { ...defaults, emby: { ...defaults.emby }, plex: { ...defaults.plex }, cloud115: { ...defaults.cloud115 }, scripts: [] }
  let obj: any = raw
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw)
    } catch {
      return { ...defaults, emby: { ...defaults.emby }, plex: { ...defaults.plex }, cloud115: { ...defaults.cloud115 }, scripts: [] }
    }
  }
  return {
    emby: { ...defaults.emby, ...(obj.emby || {}) },
    plex: { ...defaults.plex, ...(obj.plex || {}) },
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
  Storage.set(KEY, JSON.stringify(config))
}

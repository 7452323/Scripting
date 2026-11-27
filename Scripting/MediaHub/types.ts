/** MediaHub 共享类型 */

export type MediaSourceType =
  | "local"
  | "url"
  | "emby"
  | "plex"
  | "115"
  | "script"

export interface MediaItem {
  id: string
  title: string
  url: string
  poster?: string
  sourceType: MediaSourceType
  sourceName?: string
  duration?: number
  addedAt: number
  lastPlayedAt?: number
  playProgress?: number
  isFavorite?: boolean
  /** 鉴权请求头（如 115 Cookie） */
  headers?: Record<string, string>
  extra?: Record<string, any>
}

export interface PlaybackHistory {
  mediaId: string
  title: string
  url: string
  poster?: string
  progress: number
  duration: number
  playedAt: number
  headers?: Record<string, string>
}

export interface PlayerOptions {
  url: string
  title?: string
  poster?: string
  headers?: Record<string, string>
  mediaId?: string
  startTime?: number
  onProgress?: (progress: number, duration: number) => void
  onEnded?: () => void
}

/** 远程源统一条目 */
export interface RemoteMedia {
  id: string
  title: string
  url: string
  poster?: string
  sourceType: MediaSourceType
  sourceName: string
  headers?: Record<string, string>
  extra?: Record<string, any>
}

/** 首页卡片（Emby / Plex / 115 通用） */
export interface HomeCard {
  id: string
  title: string
  subtitle: string
  poster?: string
  backdrop?: string
  url: string
  headers: Record<string, string>
  /** 0~1 */
  progress: number
  positionSeconds: number
  durationSeconds: number
  kind: "movie" | "episode" | "series"
  /** 115 播放用 pickCode */
  pickCode?: string
  /** 影视分组 key（点卡片进详情页而不是直接播） */
  groupKey?: string
}

/** 首页分栏 */
export interface HomeShelf {
  key: string
  title: string
  cards: HomeCard[]
  landscape: boolean
}

/** MediaHub 共享类型定义 */

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
  /** 未来扩展字段 */
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

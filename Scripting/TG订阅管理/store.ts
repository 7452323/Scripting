import type { TelegramAudience, ThemeMode } from "./types"

// ==========================================
// 存储封装层
// ------------------------------------------
// 安全基线：源标识（身份类数据）只存 Keychain；
// 缓存快照（公开可展示）与主题偏好存 Storage。
// 所有读写都必须走此模块，避免键名与存储位置散落。
// ==========================================

/** Keychain：源标识（唯一敏感/身份类数据） */
const SOURCE_KEY = "tg_audience_source"
/** Storage：受众快照缓存 */
const CACHE_KEY = "tg_audience_cache"
/** Storage：主题偏好 */
const THEME_KEY = "tg_theme_mode"

// --- 源标识（Keychain，仅本机，不 iCloud 同步）---

/** 读取已保存的源标识；未配置返回 null */
export function getSource(): string | null {
  return Keychain.contains(SOURCE_KEY) ? Keychain.get(SOURCE_KEY) : null
}

/** 保存源标识 */
export function setSource(source: string): void {
  Keychain.set(SOURCE_KEY, source)
}

/** 清除源标识 */
export function clearSource(): void {
  if (Keychain.contains(SOURCE_KEY)) {
    Keychain.remove(SOURCE_KEY)
  }
}

// --- 受众快照缓存（Storage）---

/** 读取缓存快照；无缓存返回 null */
export function getCache(): TelegramAudience | null {
  return Storage.get<TelegramAudience>(CACHE_KEY) ?? null
}

/** 写入缓存快照 */
export function setCache(data: TelegramAudience): void {
  Storage.set(CACHE_KEY, data)
}

// --- 主题偏好（Storage）---

/** 读取主题偏好，默认 auto */
export function getTheme(): ThemeMode {
  return (Storage.get<ThemeMode>(THEME_KEY) ?? "auto")
}

/** 写入主题偏好 */
export function setTheme(mode: ThemeMode): void {
  Storage.set(THEME_KEY, mode)
}

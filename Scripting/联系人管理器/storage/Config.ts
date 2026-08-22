/**
 * SettingsService - Manage app settings via Storage
 */

import { AppSettings } from '../models/Contact'
import { DEFAULT_SETTINGS, StorageKeys } from '../utils/Constants'

/** Load settings from storage */
export function loadSettings(): AppSettings {
  const stored = Storage.get(StorageKeys.SETTINGS)
  if (!stored || typeof stored !== 'string') return { ...DEFAULT_SETTINGS }

  try {
    const parsed = JSON.parse(stored)
    return { ...DEFAULT_SETTINGS, ...parsed }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/** Save settings to storage */
export function saveSettings(settings: AppSettings): void {
  Storage.set(StorageKeys.SETTINGS, JSON.stringify(settings))
}

/** Update a single setting */
export function updateSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): AppSettings {
  const current = loadSettings()
  current[key] = value
  saveSettings(current)
  return current
}

/** Reset settings to defaults */
export function resetSettings(): AppSettings {
  saveSettings({ ...DEFAULT_SETTINGS })
  return { ...DEFAULT_SETTINGS }
}

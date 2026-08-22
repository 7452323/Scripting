/**
 * App-wide constants
 */

import { AppSettings, ContactFilter } from '../models/Contact'

/** Storage keys */
export const StorageKeys = {
  SETTINGS: 'contact_manager_settings',
  BACKUP_LIST: 'contact_manager_backups',
  LAST_BACKUP: 'contact_manager_last_backup',
  FIRST_LAUNCH: 'contact_manager_first_launch',
} as const

/** Default settings */
export const DEFAULT_SETTINGS: AppSettings = {
  autoBackup: false,
  backupFrequency: 'weekly',
  showInitials: true,
  defaultSort: 'familyName',
}

/** Default filter */
export const DEFAULT_FILTER: ContactFilter = {
  searchText: '',
  sortBy: 'familyName',
  sortAscending: true,
  showEmpty: true,
}

/** Backup directory name */
export const BACKUP_DIR = 'contact_backups'

/** File manager directory */
export const APP_DIR = 'contact_manager'

/** App version */
export const APP_VERSION = '1.0.0'

/** Phone labels */
export const PHONE_LABELS = [
  'mobile',
  'home',
  'work',
  'iphone',
  'main',
  'home fax',
  'work fax',
  'pager',
  'other',
]

/** Email labels */
export const EMAIL_LABELS = [
  'home',
  'work',
  'iCloud',
  'other',
]

/** Address labels */
export const ADDRESS_LABELS = [
  'home',
  'work',
  'school',
  'other',
]

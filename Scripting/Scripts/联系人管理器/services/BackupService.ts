/**
 * BackupService - Export and restore contact backups
 */

import { ContactInfo, BackupMeta } from '../models/Contact'
import { BACKUP_DIR } from '../utils/Constants'
import { formatDate, generateId } from '../utils/Helpers'
import { fetchAllContacts } from './ContactService'

/** Get backup directory path */
function getBackupDir(): string {
  return `${FileManager.documentsDirectory}/${BACKUP_DIR}`
}

/** Ensure backup directory exists */
async function ensureBackupDir(): Promise<void> {
  const dir = getBackupDir()
  if (!await FileManager.exists(dir)) {
    await FileManager.createDirectory(dir)
  }
}

/** Create a backup of all contacts */
export async function createBackup(): Promise<BackupMeta> {
  await ensureBackupDir()

  const contacts = await fetchAllContacts(false)
  const id = generateId()
  const timestamp = Date.now()
  const fileName = `contacts_backup_${timestamp}.json`
  const filePath = `${getBackupDir()}/${fileName}`

  const backupData = {
    version: 1,
    timestamp,
    count: contacts.length,
    contacts: contacts.map(c => ({
      identifier: c.identifier,
      givenName: c.givenName,
      familyName: c.familyName,
      phoneNumbers: c.phoneNumbers,
      emailAddresses: c.emailAddresses,
      postalAddresses: c.postalAddresses,
      organizationName: c.organizationName,
      jobTitle: c.jobTitle,
      departmentName: c.departmentName,
    })),
  }

  await FileManager.writeAsString(filePath, JSON.stringify(backupData, null, 2))

  const meta: BackupMeta = {
    id,
    date: timestamp,
    count: contacts.length,
    fileName,
  }

  return meta
}

/** Get list of all backups */
export async function listBackups(): Promise<BackupMeta[]> {
  const dir = getBackupDir()
  if (!await FileManager.exists(dir)) return []

  const files = await FileManager.readDirectory(dir)
  const backups: BackupMeta[] = []

  for (const file of files) {
    if (file.endsWith('.json') && file.includes('contacts_backup_')) {
      const timestamp = parseInt(file.replace('contacts_backup_', '').replace('.json', ''))
      if (!isNaN(timestamp)) {
        let count = 0
        try {
          const content = await FileManager.readAsString(`${dir}/${file}`)
          const data = JSON.parse(content)
          count = data.count || 0
        } catch { /* ignore */ }

        backups.push({
          id: timestamp.toString(36),
          date: timestamp,
          count,
          fileName: file,
        })
      }
    }
  }

  backups.sort((a, b) => b.date - a.date)
  return backups
}

/** Load a backup from file */
export async function loadBackup(fileName: string): Promise<ContactInfo[]> {
  const filePath = `${getBackupDir()}/${fileName}`
  if (!await FileManager.exists(filePath)) {
    throw new Error('Backup file not found')
  }

  const content = await FileManager.readAsString(filePath)
  const data = JSON.parse(content)
  return data.contacts as ContactInfo[]
}

/** Delete a backup */
export async function deleteBackup(fileName: string): Promise<void> {
  const filePath = `${getBackupDir()}/${fileName}`
  if (await FileManager.exists(filePath)) {
    await FileManager.remove(filePath)
  }
}

/** Restore contacts from backup (creates new contacts) */
export async function restoreFromBackup(fileName: string): Promise<{ created: number; failed: number }> {
  const contacts = await loadBackup(fileName)
  let created = 0
  let failed = 0

  for (const c of contacts) {
    try {
      await Contact.createContact({
        givenName: c.givenName,
        familyName: c.familyName,
        phoneNumbers: c.phoneNumbers,
        emailAddresses: c.emailAddresses,
        postalAddresses: c.postalAddresses,
        organizationName: c.organizationName,
        jobTitle: c.jobTitle,
      })
      created++
    } catch {
      failed++
    }
  }

  return { created, failed }
}

/** Export contacts as vCard string */
export function exportToVCard(contacts: ContactInfo[]): string {
  const cards: string[] = []

  for (const c of contacts) {
    const lines = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      `FN:${c.familyName}${c.givenName}`,
      `N:${c.familyName};${c.givenName};;;`,
    ]

    if (c.organizationName) lines.push(`ORG:${c.organizationName}`)
    if (c.jobTitle) lines.push(`TITLE:${c.jobTitle}`)

    for (const phone of c.phoneNumbers || []) {
      const type = phone.label.toUpperCase()
      lines.push(`TEL;TYPE=${type}:${phone.value}`)
    }

    for (const email of c.emailAddresses || []) {
      const type = email.label.toUpperCase()
      lines.push(`EMAIL;TYPE=${type}:${email.value}`)
    }

    for (const addr of c.postalAddresses || []) {
      const type = addr.label.toUpperCase()
      lines.push(
        `ADR;TYPE=${type}:;;${addr.street};${addr.city};${addr.state};${addr.postalCode};${addr.country}`
      )
    }

    lines.push('END:VCARD')
    cards.push(lines.join('\r\n'))
  }

  return cards.join('\r\n\r\n')
}

/** Get backup directory size in bytes */
export async function getBackupDirSize(): Promise<number> {
  const dir = getBackupDir()
  if (!await FileManager.exists(dir)) return 0
  const files = await FileManager.readDirectory(dir)
  let totalSize = 0
  for (const file of files) {
    const filePath = `${dir}/${file}`
    const stat = await FileManager.stat(filePath)
    if (stat) totalSize += stat.size || 0
  }
  return totalSize
}

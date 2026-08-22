/**
 * DuplicateService - Detect and manage duplicate contacts
 */

import { ContactInfo, DuplicateGroup } from '../models/Contact'
import { getFullName, getPrimaryPhone, getPrimaryEmail } from '../utils/Helpers'

/** Detect duplicate contacts by name */
export function findDuplicatesByName(contacts: ContactInfo[]): DuplicateGroup[] {
  const map = new Map<string, ContactInfo[]>()

  for (const c of contacts) {
    const name = getFullName(c).toLowerCase().trim()
    if (!name || name === '无姓名') continue
    if (!map.has(name)) map.set(name, [])
    map.get(name)!.push(c)
  }

  const groups: DuplicateGroup[] = []
  for (const [key, groupContacts] of map) {
    if (groupContacts.length > 1) {
      groups.push({
        key,
        contacts: groupContacts,
        reason: '姓名相同',
      })
    }
  }
  return groups
}

/** Detect duplicate contacts by phone number */
export function findDuplicatesByPhone(contacts: ContactInfo[]): DuplicateGroup[] {
  const map = new Map<string, ContactInfo[]>()

  for (const c of contacts) {
    for (const phone of c.phoneNumbers || []) {
      const normalized = phone.value.replace(/[\s\-\(\)]/g, '')
      if (normalized.length < 3) continue
      if (!map.has(normalized)) map.set(normalized, [])
      const existing = map.get(normalized)!
      if (!existing.find(e => e.identifier === c.identifier)) {
        existing.push(c)
      }
    }
  }

  const groups: DuplicateGroup[] = []
  for (const [key, groupContacts] of map) {
    if (groupContacts.length > 1) {
      groups.push({
        key,
        contacts: groupContacts,
        reason: '电话相同',
      })
    }
  }
  return groups
}

/** Detect duplicate contacts by email */
export function findDuplicatesByEmail(contacts: ContactInfo[]): DuplicateGroup[] {
  const map = new Map<string, ContactInfo[]>()

  for (const c of contacts) {
    for (const email of c.emailAddresses || []) {
      const normalized = email.value.toLowerCase().trim()
      if (!normalized) continue
      if (!map.has(normalized)) map.set(normalized, [])
      const existing = map.get(normalized)!
      if (!existing.find(e => e.identifier === c.identifier)) {
        existing.push(c)
      }
    }
  }

  const groups: DuplicateGroup[] = []
  for (const [key, groupContacts] of map) {
    if (groupContacts.length > 1) {
      groups.push({
        key,
        contacts: groupContacts,
        reason: '邮箱相同',
      })
    }
  }
  return groups
}

/** Find all duplicates (combined) */
export function findAllDuplicates(contacts: ContactInfo[]): DuplicateGroup[] {
  const nameGroups = findDuplicatesByName(contacts)
  const phoneGroups = findDuplicatesByPhone(contacts)
  const emailGroups = findDuplicatesByEmail(contacts)

  // Merge groups that share contacts
  const allGroups = [...nameGroups, ...phoneGroups, ...emailGroups]
  const merged = mergeOverlappingGroups(allGroups)
  return merged
}

/** Merge groups that share at least one contact */
function mergeOverlappingGroups(groups: DuplicateGroup[]): DuplicateGroup[] {
  const result: DuplicateGroup[] = []
  const used = new Set<string>()

  for (let i = 0; i < groups.length; i++) {
    if (used.has(groups[i].key)) continue

    const merged = { ...groups[i] }
    const ids = new Set(groups[i].contacts.map(c => c.identifier))

    for (let j = i + 1; j < groups.length; j++) {
      if (used.has(groups[j].key)) continue
      const overlap = groups[j].contacts.some(c => ids.has(c.identifier))
      if (overlap) {
        // Merge contacts
        for (const c of groups[j].contacts) {
          if (!ids.has(c.identifier)) {
            merged.contacts.push(c)
            ids.add(c.identifier)
          }
        }
        // Merge reason
        if (!merged.reason.includes(groups[j].reason)) {
          merged.reason += ` + ${groups[j].reason}`
        }
        used.add(groups[j].key)
      }
    }

    if (merged.contacts.length > 1) {
      result.push(merged)
    }
    used.add(groups[i].key)
  }

  return result
}

/** Get total duplicate count (contacts that have at least one duplicate) */
export function getDuplicateContactCount(groups: DuplicateGroup[]): number {
  const ids = new Set<string>()
  for (const g of groups) {
    for (const c of g.contacts) {
      ids.add(c.identifier)
    }
  }
  return ids.size
}

/** Merge duplicate contacts - keep the first one, merge data from others */
export function mergeDuplicateContacts(group: DuplicateGroup): ContactInfo {
  const [primary, ...others] = group.contacts

  // Merge phone numbers
  const allPhones = [...(primary.phoneNumbers || [])]
  for (const other of others) {
    for (const phone of other.phoneNumbers || []) {
      if (!allPhones.some(p => p.value === phone.value)) {
        allPhones.push(phone)
      }
    }
  }

  // Merge emails
  const allEmails = [...(primary.emailAddresses || [])]
  for (const other of others) {
    for (const email of other.emailAddresses || []) {
      if (!allEmails.some(e => e.value.toLowerCase() === email.value.toLowerCase())) {
        allEmails.push(email)
      }
    }
  }

  // Merge addresses
  const allAddresses = [...(primary.postalAddresses || [])]
  for (const other of others) {
    for (const addr of other.postalAddresses || []) {
      const exists = allAddresses.some(
        a => a.street === addr.street && a.city === addr.city
      )
      if (!exists) allAddresses.push(addr)
    }
  }

  // Merge notes
  const notes = [primary.note, ...others.map(o => o.note)].filter(Boolean)
  const mergedNote = notes.join('\n---\n')

  return {
    ...primary,
    phoneNumbers: allPhones,
    emailAddresses: allEmails,
    postalAddresses: allAddresses,
    note: mergedNote || primary.note,
  }
}

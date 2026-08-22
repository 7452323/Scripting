/**
 * Helper utilities
 */

import { ContactInfo, DisplayContact } from '../models/Contact'

/** Get display name from contact */
export function getFullName(contact: ContactInfo): string {
  const parts = [contact.familyName, contact.givenName].filter(Boolean)
  if (parts.length > 0) return parts.join('')
  if (contact.organizationName) return contact.organizationName
  return '无姓名'
}

/** Get initials from contact name */
export function getInitials(contact: ContactInfo): string {
  const first = contact.givenName?.[0] || ''
  const last = contact.familyName?.[0] || ''
  const initials = (last + first).toUpperCase()
  if (initials) return initials
  if (contact.organizationName) {
    return contact.organizationName.slice(0, 2).toUpperCase()
  }
  return '#'
}

/** Get primary phone number */
export function getPrimaryPhone(contact: ContactInfo): string {
  if (contact.phoneNumbers && contact.phoneNumbers.length > 0) {
    return contact.phoneNumbers[0].value
  }
  return ''
}

/** Get primary email */
export function getPrimaryEmail(contact: ContactInfo): string {
  if (contact.emailAddresses && contact.emailAddresses.length > 0) {
    return contact.emailAddresses[0].value
  }
  return ''
}

/** Get organization string */
export function getOrganization(contact: ContactInfo): string {
  return contact.organizationName || ''
}

/** Convert ContactInfo to DisplayContact */
export function toDisplayContact(contact: ContactInfo): DisplayContact {
  return {
    identifier: contact.identifier,
    fullName: getFullName(contact),
    initials: getInitials(contact),
    phone: getPrimaryPhone(contact),
    email: getPrimaryEmail(contact),
    organization: getOrganization(contact),
    hasImage: !!contact.imageData,
  }
}

/** Group contacts by first letter for sectioned list */
export function getSectionLetter(name: string): string {
  if (!name || name.length === 0) return '#'
  const first = name[0].toUpperCase()
  if (first >= 'A' && first <= 'Z') return first
  // For CJK characters, return as-is
  return first
}

/** Format date to readable string */
export function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}`
}

/** Generate unique ID */
export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

/** Debounce function */
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timer: any
  return function (this: any, ...args: Parameters<T>) {
    clearTimeout(timer)
    timer = setTimeout(() => fn.apply(this, args), delay)
  }
}

/** Deep clone via JSON */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

/** Sanitize filename */
export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, '_')
}

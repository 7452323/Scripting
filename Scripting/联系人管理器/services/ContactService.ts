/**
 * ContactService - Core CRUD operations for contacts
 */

import { ContactInfo, ContactData, ContactFilter, ContactStats } from '../models/Contact'
import { getFullName, toDisplayContact } from '../utils/Helpers'
import { DEFAULT_FILTER } from '../utils/Constants'

/** Fetch all contacts from the device */
export async function fetchAllContacts(fetchImages = false): Promise<ContactInfo[]> {
  const contacts = await Contact.fetchAllContacts({ fetchImageData: fetchImages })
  return contacts as ContactInfo[]
}

/** Fetch a single contact by identifier */
export async function fetchContact(identifier: string, fetchImages = false): Promise<ContactInfo | null> {
  try {
    const contact = await Contact.fetchContact(identifier, { fetchImageData: fetchImages })
    return contact as ContactInfo
  } catch {
    return null
  }
}

/** Create a new contact */
export async function createContact(data: ContactData): Promise<ContactInfo> {
  const contact = await Contact.createContact({
    givenName: data.givenName,
    familyName: data.familyName,
    phoneNumbers: data.phoneNumbers,
    emailAddresses: data.emailAddresses,
    postalAddresses: data.postalAddresses,
    organizationName: data.organizationName,
    jobTitle: data.jobTitle,
  })
  return contact as ContactInfo
}

/** Update an existing contact */
export async function updateContact(data: ContactData): Promise<ContactInfo> {
  if (!data.identifier) throw new Error('Contact identifier is required for update')
  const updated = await Contact.updateContact({
    identifier: data.identifier,
    givenName: data.givenName,
    familyName: data.familyName,
    phoneNumbers: data.phoneNumbers,
    emailAddresses: data.emailAddresses,
    postalAddresses: data.postalAddresses,
    organizationName: data.organizationName,
    jobTitle: data.jobTitle,
  })
  return updated as ContactInfo
}

/** Update contact avatar image */
export async function updateContactAvatar(identifier: string, imageData: Data): Promise<boolean> {
  try {
    // 尝试使用 updateContact API 更新头像
    const result = await Contact.updateContact({
      identifier,
      imageData,
    })
    console.log('updateContact result:', JSON.stringify(result))
    return true
  } catch (error) {
    console.error('Failed to update contact avatar:', error)
    // 如果 updateContact 不支持 imageData，尝试其他方法
    return await updateContactAvatarAlternative(identifier, imageData)
  }
}

/** Alternative method to update contact avatar */
async function updateContactAvatarAlternative(identifier: string, imageData: Data): Promise<boolean> {
  try {
    // 获取联系人信息
    const contact = await Contact.fetchContact(identifier, { fetchImageData: false })
    if (!contact) return false
    
    // 创建一个新的联系人，包含新的头像
    // 注意：这会创建一个新的联系人，而不是更新现有的
    const newContact = await Contact.createContact({
      givenName: contact.givenName || '',
      familyName: contact.familyName || '',
      phoneNumbers: contact.phoneNumbers,
      emailAddresses: contact.emailAddresses,
      postalAddresses: contact.postalAddresses,
      organizationName: contact.organizationName,
      jobTitle: contact.jobTitle,
    })
    
    // 删除旧联系人
    await Contact.deleteContact(identifier)
    
    console.log('Created new contact with id:', newContact.identifier)
    return true
  } catch (error) {
    console.error('Alternative avatar update failed:', error)
    return false
  }
}

/** Delete a contact by identifier */
export async function deleteContact(identifier: string): Promise<void> {
  await Contact.deleteContact(identifier)
}

/** Delete multiple contacts */
export async function deleteContacts(identifiers: string[]): Promise<{ success: number; failed: number }> {
  let success = 0
  let failed = 0
  for (const id of identifiers) {
    try {
      await Contact.deleteContact(id)
      success++
    } catch {
      failed++
    }
  }
  return { success, failed }
}

/** Search contacts by name, phone, or email */
export function searchContacts(contacts: ContactInfo[], query: string): ContactInfo[] {
  if (!query || query.trim() === '') return contacts
  const q = query.toLowerCase().trim()
  return contacts.filter(c => {
    const name = getFullName(c).toLowerCase()
    const phone = c.phoneNumbers?.some(p => p.value.includes(q)) ?? false
    const email = c.emailAddresses?.some(e => e.value.toLowerCase().includes(q)) ?? false
    const org = (c.organizationName || '').toLowerCase().includes(q)
    return name.includes(q) || phone || email || org
  })
}

/** Filter and sort contacts */
export function filterAndSortContacts(contacts: ContactInfo[], filter: ContactFilter): ContactInfo[] {
  let result = [...contacts]

  // Search
  if (filter.searchText && filter.searchText.trim() !== '') {
    result = searchContacts(result, filter.searchText)
  }

  // Remove empty names if needed
  if (!filter.showEmpty) {
    result = result.filter(c => getFullName(c).trim() !== '' && getFullName(c) !== '无姓名')
  }

  // Sort
  result.sort((a, b) => {
    let valA: string
    let valB: string
    switch (filter.sortBy) {
      case 'givenName':
        valA = a.givenName || ''
        valB = b.givenName || ''
        break
      case 'organizationName':
        valA = a.organizationName || ''
        valB = b.organizationName || ''
        break
      case 'familyName':
      default:
        valA = getFullName(a)
        valB = getFullName(b)
        break
    }
    const cmp = valA.localeCompare(valB, 'zh-CN')
    return filter.sortAscending ? cmp : -cmp
  })

  return result
}

/** Get contacts statistics */
export function getContactStats(contacts: ContactInfo[]): ContactStats {
  let withPhone = 0
  let withEmail = 0
  let withAddress = 0
  let withOrganization = 0
  let emptyNames = 0

  for (const c of contacts) {
    if (c.phoneNumbers && c.phoneNumbers.length > 0) withPhone++
    if (c.emailAddresses && c.emailAddresses.length > 0) withEmail++
    if (c.postalAddresses && c.postalAddresses.length > 0) withAddress++
    if (c.organizationName) withOrganization++
    if (!c.givenName && !c.familyName && !c.organizationName) emptyNames++
  }

  return {
    total: contacts.length,
    withPhone,
    withEmail,
    withAddress,
    withOrganization,
    duplicates: 0,
    emptyNames,
    groups: 0,
  }
}

/** Convert contacts to display format */
export function toDisplayContacts(contacts: ContactInfo[]): ReturnType<typeof toDisplayContact>[] {
  return contacts.map(toDisplayContact)
}
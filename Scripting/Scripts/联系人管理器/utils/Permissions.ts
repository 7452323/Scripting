/**
 * Permission management utilities
 */

import { Script } from 'scripting'

/**
 * Request contacts access permission.
 * Returns true if permission is granted, false otherwise.
 */
export async function requestContactsPermission(): Promise<boolean> {
  try {
    await Script.requestAccess(["contacts"])
    return true
  } catch (error) {
    console.warn('Contacts permission denied:', error)
    return false
  }
}

/**
 * Check if contacts permission is already granted.
 * Tries to fetch contacts to verify access.
 */
export async function checkContactsPermission(): Promise<boolean> {
  try {
    await Contact.fetchAllContacts({ fetchImageData: false })
    return true
  } catch (error) {
    return false
  }
}

/**
 * Contact model types for the Contact Manager app.
 * Wraps the native Contact API types with app-specific interfaces.
 */

/** Labeled phone number or email value */
export interface LabeledValue {
  label: string
  value: string
}

/** Postal address */
export interface PostalAddress {
  label: string
  street: string
  city: string
  state: string
  postalCode: string
  country: string
  isoCountryCode: string
}

/** Contact data used for creating/updating */
export interface ContactData {
  identifier?: string
  givenName: string
  familyName: string
  phoneNumbers: LabeledValue[]
  emailAddresses: LabeledValue[]
  postalAddresses: PostalAddress[]
  note?: string
  organizationName?: string
  jobTitle?: string
}

/** Full contact info as returned by the native API */
export interface ContactInfo {
  identifier: string
  givenName: string
  familyName: string
  phoneNumbers: LabeledValue[]
  emailAddresses: LabeledValue[]
  postalAddresses: PostalAddress[]
  note?: string
  organizationName?: string
  jobTitle?: string
  imageData?: Data
  thumbnailImageData?: Data
  birthday?: Date
  departmentName?: string
}

/** Display contact - simplified for list rendering */
export interface DisplayContact {
  identifier: string
  fullName: string
  initials: string
  phone: string
  email: string
  organization: string
  hasImage: boolean
  imageData?: Data
}

/** Duplicate group */
export interface DuplicateGroup {
  key: string
  contacts: ContactInfo[]
  reason: string
}

/** Backup metadata */
export interface BackupMeta {
  id: string
  date: number
  count: number
  fileName: string
}

/** Statistics data */
export interface ContactStats {
  total: number
  withPhone: number
  withEmail: number
  withAddress: number
  withOrganization: number
  duplicates: number
  emptyNames: number
  groups: number
}

/** Filter options for contact list */
export interface ContactFilter {
  searchText: string
  sortBy: 'givenName' | 'familyName' | 'organizationName'
  sortAscending: boolean
  showEmpty: boolean
}

/** App settings */
export interface AppSettings {
  autoBackup: boolean
  backupFrequency: 'daily' | 'weekly' | 'monthly'
  showInitials: boolean
  defaultSort: 'givenName' | 'familyName' | 'organizationName'
  lastBackupTime?: number
}

/**
 * index.tsx - Entry point for Contact Manager
 * Presents the main contact list view (fullscreen + toolbar close button)
 */

import { useState, useEffect } from 'scripting'
import { Navigation, Script, NavigationStack } from 'scripting'
import { ContactInfo } from './models/Contact'
import { fetchAllContacts } from './services/ContactService'
import { checkContactsPermission, requestContactsPermission } from './utils/Permissions'
import { HomePage } from './pages/HomePage'
import { ContactDetailPage } from './pages/ContactDetailPage'
import { DuplicatePage } from './pages/DuplicatePage'
import { BackupPage } from './pages/BackupPage'
import { StatisticsPage } from './pages/StatisticsPage'
import { SettingsPage } from './pages/SettingsPage'

type Page =
  | { type: 'home' }
  | { type: 'detail'; contact: ContactInfo }
  | { type: 'duplicate' }
  | { type: 'backup' }
  | { type: 'statistics' }
  | { type: 'settings' }

function App() {
  const [contacts, setContacts] = useState<ContactInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [permissionGranted, setPermissionGranted] = useState(false)
  const [page, setPage] = useState<Page>({ type: 'home' })

  useEffect(() => {
    checkPermissionAndLoad()
  }, [])

  const checkPermissionAndLoad = async () => {
    const hasPermission = await checkContactsPermission()
    if (hasPermission) {
      setPermissionGranted(true)
      await loadContacts()
    } else {
      const granted = await requestContactsPermission()
      if (granted) {
        setPermissionGranted(true)
        await loadContacts()
      } else {
        setPermissionGranted(false)
        setLoading(false)
      }
    }
  }

  const loadContacts = async () => {
    setLoading(true)
    try {
      const data = await fetchAllContacts(true)
      setContacts(data)
    } catch (error) {
      console.error('Failed to load contacts:', error)
      await Dialog.alert({ title: '加载失败', message: '无法读取联系人数据' })
    }
    setLoading(false)
  }

  const navigateTo = (newPage: Page) => setPage(newPage)
  const goHome = () => {
    setPage({ type: 'home' })
    loadContacts()
  }

  if (loading) {
    return (
      <NavigationStack statusBarHidden persistentSystemOverlays="hidden">
        <HomePage contacts={[]} onNavigate={navigateTo} loading={true} onReload={loadContacts} />
      </NavigationStack>
    )
  }

  if (!permissionGranted) {
    return (
      <NavigationStack statusBarHidden persistentSystemOverlays="hidden">
        <HomePage contacts={[]} onNavigate={navigateTo} loading={false} permissionDenied={true} onReload={loadContacts} />
      </NavigationStack>
    )
  }

  switch (page.type) {
    case 'detail':
      return <ContactDetailPage contact={page.contact} onSave={goHome} onDelete={goHome} onBack={goHome} />
    case 'duplicate':
      return <DuplicatePage contacts={contacts} onComplete={goHome} onBack={goHome} />
    case 'backup':
      return <BackupPage contacts={contacts} onBack={goHome} />
    case 'statistics':
      return <StatisticsPage contacts={contacts} onBack={goHome} />
    case 'settings':
      return <SettingsPage onBack={goHome} />
    case 'home':
    default:
      return <HomePage contacts={contacts} onNavigate={navigateTo} onReload={loadContacts} />
  }
}

Script.enableMinimize()
Navigation.present({ element: <App />, modalPresentationStyle: "fullScreen" }).then(() => Script.exit())

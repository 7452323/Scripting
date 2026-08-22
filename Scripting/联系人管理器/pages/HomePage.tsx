/**
 * HomePage - Main contact list with multi-select, search, and navigation
 * Styled like 番茄下载: fullscreen + toolbar close button
 */

import { useState, useCallback } from 'scripting'
import {
  Navigation, NavigationStack, List, Section, Text, VStack, HStack,
  Button, Image, ContentUnavailableView, TextField, Spacer
} from 'scripting'
import { ContactInfo, ContactFilter } from '../models/Contact'
import { filterAndSortContacts, deleteContacts, updateContactAvatar } from '../services/ContactService'
import { getFullName } from '../utils/Helpers'
import { DEFAULT_FILTER } from '../utils/Constants'
import { ContactRow } from '../components/ContactRow'
import { BottomToolbar } from '../components/BottomToolbar'
import { CropView } from '../components/CropView'
import { requestContactsPermission } from '../utils/Permissions'

interface HomePageProps {
  contacts: ContactInfo[]
  onNavigate: (page: any) => void
  loading?: boolean
  permissionDenied?: boolean
  onReload?: () => void
}

export function HomePage({ contacts, onNavigate, loading, permissionDenied, onReload }: HomePageProps) {
  const dismiss = Navigation.useDismiss()
  const [filter, setFilter] = useState<ContactFilter>({ ...DEFAULT_FILTER, sortBy: 'familyName' })
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isSelecting, setIsSelecting] = useState(false)
  const [showCrop, setShowCrop] = useState(false)
  const [cropImage, setCropImage] = useState<UIImage | null>(null)
  const [cropContactId, setCropContactId] = useState<string | null>(null)

  const filteredContacts = filterAndSortContacts(contacts, filter)

  const applyFilter = useCallback((searchText: string) => {
    setFilter((prev: ContactFilter) => ({ ...prev, searchText }))
  }, [])

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev: Set<string>) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
    setIsSelecting(false)
  }, [])

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(filteredContacts.map((c: ContactInfo) => c.identifier!)))
  }, [filteredContacts])

  const deleteSelected = useCallback(async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return

    const confirmed = await Dialog.confirm({
      title: '删除联系人',
      message: `确定要删除选中的 ${ids.length} 个联系人吗？`,
      confirmLabel: '删除',
      cancelLabel: '取消',
    })
    if (!confirmed) return

    const result = await deleteContacts(ids)
    clearSelection()

    await Dialog.alert({
      title: '删除完成',
      message: `成功删除 ${result.success} 个，失败 ${result.failed} 个`,
    })
  }, [selectedIds, clearSelection])

  const deleteSingleContact = useCallback(async (id: string) => {
    const confirmed = await Dialog.confirm({
      title: '删除联系人',
      message: '确定要删除这个联系人吗？',
      confirmLabel: '删除',
      cancelLabel: '取消',
    })
    if (!confirmed) return
    await deleteContacts([id])
    onReload?.()
  }, [onReload])

  const changeAvatar = useCallback(async (contact: ContactInfo) => {
    const images = await Photos.pickPhotos(1)
    if (!images || images.length === 0) return
    setCropImage(images[0])
    setCropContactId(contact.identifier!)
    setShowCrop(true)
  }, [])

  const handleCropConfirm = useCallback(async (croppedImage: UIImage) => {
    if (cropContactId) {
      // 保存裁剪后的图片到文件，并存储文件路径
      const fileName = `avatar_${cropContactId}.jpg`
      const filePath = FileManager.documentsDirectory + '/' + fileName
      const jpegData = croppedImage.toJPEGData(0.8)
      if (jpegData) {
        FileManager.writeAsDataSync(filePath, jpegData)
        Storage.set(`avatar_path_${cropContactId}`, filePath)
        
        // 尝试同步头像到系统通讯录
        const syncResult = await updateContactAvatar(cropContactId, jpegData)
        
        setShowCrop(false)
        setCropImage(null)
        setCropContactId(null)
        onReload?.()
        
        // 显示同步结果
        if (syncResult) {
          await Dialog.alert({
            title: '保存成功',
            message: '头像已保存到应用内',
            buttonLabel: '确定',
          })
        } else {
          // 同步失败，但本地保存成功
          await Dialog.alert({
            title: '保存成功',
            message: '头像已保存到应用内，但无法同步到系统通讯录（API 限制）。应用内仍可正常显示。',
            buttonLabel: '确定',
          })
        }
      } else {
        setShowCrop(false)
        setCropImage(null)
        setCropContactId(null)
      }
    } else {
      setShowCrop(false)
      setCropImage(null)
      setCropContactId(null)
    }
  }, [cropContactId, onReload])

  const handleCropCancel = useCallback(() => {
    setShowCrop(false)
    setCropImage(null)
    setCropContactId(null)
  }, [])

  const retryPermission = useCallback(async () => {
    const granted = await requestContactsPermission()
    if (granted) {
      // Trigger re-check by navigating home
      onNavigate({ type: 'home' })
    }
  }, [onNavigate])

  const groupedContacts = groupByLetter(filteredContacts)

  // Loading state
  if (loading) {
    return (
      <NavigationStack statusBarHidden persistentSystemOverlays="hidden">
        <List
          navigationTitle="联系人管理器"
          navigationBarTitleDisplayMode="large"
          toolbar={{
            topBarTrailing: (
              <Button action={dismiss} buttonStyle="borderless"><Image systemName="xmark.circle.fill" imageScale="medium" foregroundStyle="systemGray" /></Button>
            ),
          }}
        >
          <Section>
            <VStack padding={40} alignment="center">
              <Text foregroundStyle="secondaryLabel">加载中...</Text>
            </VStack>
          </Section>
        </List>
      </NavigationStack>
    )
  }

  // Permission denied state
  if (permissionDenied) {
    return (
      <NavigationStack statusBarHidden persistentSystemOverlays="hidden">
        <List
          navigationTitle="需要权限"
          navigationBarTitleDisplayMode="large"
          toolbar={{
            topBarTrailing: (
              <Button action={dismiss} buttonStyle="borderless"><Image systemName="xmark.circle.fill" imageScale="medium" foregroundStyle="systemGray" /></Button>
            ),
          }}
        >
          <Section>
            <VStack padding={40} alignment="center" spacing={16}>
              <Text font="title2" fontWeight="semibold">需要通讯录权限</Text>
              <Text font="body" foregroundStyle="secondaryLabel">
                联系人管理器需要访问您的通讯录才能正常工作。请在设置中允许访问。
              </Text>
              <Button title="重试" action={retryPermission} buttonStyle="borderedProminent" />
            </VStack>
          </Section>
        </List>
      </NavigationStack>
    )
  }

  return (
    <NavigationStack statusBarHidden persistentSystemOverlays="hidden">
      <List
        navigationTitle="联系人"
        navigationBarTitleDisplayMode="large"
        toolbar={{
          topBarLeading: isSelecting ? (
            <Button action={selectAll} buttonStyle="borderless">
              <Text font="subheadline" foregroundStyle="systemBlue">全选</Text>
            </Button>
          ) : undefined,
          topBarTrailing: (
            <Button action={dismiss} buttonStyle="borderless"><Image systemName="xmark.circle.fill" imageScale="medium" foregroundStyle="systemGray" /></Button>
          ),
        }}
      >
        {/* Search Bar - 番茄下载 style */}
        <Section>
          <TextField
            title=""
            value={filter.searchText}
            onChanged={applyFilter}
            prompt="搜索联系人..."
            padding={{ horizontal: 12, vertical: 10 }}
            background={{ style: "secondarySystemBackground", shape: { type: "rect" as const, cornerRadius: 10 } }}
            font={14}
            submitLabel="search"
          />
        </Section>

        {/* Toolbar actions */}
        <Section padding={{ top: 4, bottom: 8 }}>
          <HStack padding={{ leading: 16, trailing: 16 }}>
            <Button action={() => onNavigate({ type: 'duplicate' })} buttonStyle="bordered" controlSize="small">
              <VStack spacing={2}>
                <Image systemName="person.2" imageScale="small" foregroundStyle="#007AFF" />
                <Text font="caption2" foregroundStyle="#007AFF">查重</Text>
              </VStack>
            </Button>
            <Spacer />
            <Button action={() => onNavigate({ type: 'backup' })} buttonStyle="bordered" controlSize="small">
              <VStack spacing={2}>
                <Image systemName="externaldrive" imageScale="small" foregroundStyle="#34C759" />
                <Text font="caption2" foregroundStyle="#34C759">备份</Text>
              </VStack>
            </Button>
            <Spacer />
            <Button action={() => setIsSelecting(true)} buttonStyle="bordered" controlSize="small">
              <VStack spacing={2}>
                <Image systemName="checkmark.circle" imageScale="small" foregroundStyle="#FF2D55" />
                <Text font="caption2" foregroundStyle="#FF2D55">批量</Text>
              </VStack>
            </Button>
            <Spacer />
            <Button action={() => onNavigate({ type: 'statistics' })} buttonStyle="bordered" controlSize="small">
              <VStack spacing={2}>
                <Image systemName="chart.bar" imageScale="small" foregroundStyle="#FF9500" />
                <Text font="caption2" foregroundStyle="#FF9500">统计</Text>
              </VStack>
            </Button>
            <Spacer />
            <Button action={() => onNavigate({ type: 'settings' })} buttonStyle="bordered" controlSize="small">
              <VStack spacing={2}>
                <Image systemName="gear" imageScale="small" foregroundStyle="#8E8E93" />
                <Text font="caption2" foregroundStyle="#8E8E93">设置</Text>
              </VStack>
            </Button>
          </HStack>
        </Section>

        {/* Contact list */}
        {filteredContacts.length === 0 ? (
          <Section>
            <ContentUnavailableView
              title="无联系人"
              systemImage="person.crop.circle.badge.xmark"
              description={filter.searchText ? "未找到匹配的联系人" : "您的通讯录是空的"}
            />
          </Section>
        ) : (
          groupedContacts.map((group) => (
            <Section
              key={group.letter}
              header={<Text font="footnote" foregroundStyle="secondaryLabel">{group.letter}</Text>}
              sectionIndexLabel={group.letter}
            >
              {group.contacts.map((contact) => {
                let imageData: Data | undefined
                // 优先从文件路径加载自定义头像
                const avatarPath = Storage.get(`avatar_path_${contact.identifier}`) as string | undefined
                if (avatarPath) {
                  const data = FileManager.readAsDataSync(avatarPath)
                  if (data && data.size > 0) imageData = data
                }
                // 如果不存在自定义头像，使用 iPhone 通讯录的头像
                if (!imageData) {
                  // 优先使用 thumbnailImageData（小图），否则使用 imageData
                  if (contact.thumbnailImageData && contact.thumbnailImageData.size > 0) {
                    imageData = contact.thumbnailImageData
                  } else if (contact.imageData && contact.imageData.size > 0) {
                    // 缩略图不存在时使用原图
                    imageData = contact.imageData
                  }
                }
                const display = {
                  identifier: contact.identifier,
                  fullName: getFullName(contact),
                  initials: '',
                  phone: contact.phoneNumbers?.[0]?.value || '',
                  email: contact.emailAddresses?.[0]?.value || '',
                  organization: contact.organizationName || '',
                  hasImage: !!imageData,
                  imageData,
                }
                return (
                  <ContactRow
                    key={contact.identifier}
                    contact={display}
                    selected={selectedIds.has(contact.identifier)}
                    selectionMode={isSelecting}
                    onTap={() => {
                      if (isSelecting) {
                        toggleSelection(contact.identifier)
                      } else {
                        onNavigate({ type: 'detail', contact })
                      }
                    }}
                    onLongPress={() => {
                      setIsSelecting(true)
                      toggleSelection(contact.identifier)
                    }}
                    onDelete={() => deleteSingleContact(contact.identifier!)}
                    onChangeAvatar={() => changeAvatar(contact)}
                  />
                )
              })}
            </Section>
          ))
        )}
      </List>

      {/* Selection toolbar */}
      {isSelecting && (
        <BottomToolbar
          visible={true}
          actions={[
            ...(selectedIds.size > 0 ? [{
              title: `删除(${selectedIds.size})`,
              systemImage: 'trash.fill',
              destructive: true,
              action: deleteSelected,
            }] : []),
            {
              title: '取消',
              systemImage: 'xmark',
              action: clearSelection,
            },
          ]}
        />
      )}

      {/* Crop overlay */}
      {showCrop && cropImage && (
        <CropView
          image={cropImage}
          onConfirm={handleCropConfirm}
          onCancel={handleCropCancel}
        />
      )}
    </NavigationStack>
  )
}

/** Group contacts by first character */
function groupByLetter(contacts: ContactInfo[]): { letter: string; contacts: ContactInfo[] }[] {
  const map = new Map<string, ContactInfo[]>()
  for (const c of contacts) {
    const name = getFullName(c)
    const letter = name.length > 0 ? name[0].toUpperCase() : '#'
    if (!map.has(letter)) map.set(letter, [])
    map.get(letter)!.push(c)
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0], 'zh-CN'))
    .map(([letter, items]) => ({ letter, contacts: items }))
}

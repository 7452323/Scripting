import {
  Button,
  ContentUnavailableView,
  DatePicker,
  HStack,
  Image,
  List,
  MagnifyGesture,
  Navigation,
  NavigationLink,
  NavigationStack,
  NamespaceReader,
  Notification,
  Picker,
  ProgressView,
  Script,
  ScrollView,
  Section,
  Spacer,
  Text,
  Toggle,
  VideoPlayer,
  VStack,
  ZStack,
  useEffect,
  useRef,
  useState,
} from "scripting"

type CleanerKind = "contacts" | "contactDuplicates" | "contactGroups" | "photos" | "photoDuplicates" | "albums" | "reminders" | "events" | "notifications" | "safariDownloads" | "safariScripts" | "appCache"
type CleanItem = { id: string; title: string; subtitle: string; raw: any; thumbnail?: UIImage | null; thumbnails?: (UIImage | null)[] }

type Overview = {
  contacts: number | null
  contactDuplicates: number | null
  contactGroups: number | null
  photos: number | null
  photoDuplicates: number | null
  albums: number | null
  reminders: number | null
  events: number | null
  notifications: number | null
  safariDownloads: number | null
  safariScripts: number | null
  appCache: number | null
}

const EMPTY_OVERVIEW: Overview = {
  contacts: null,
  contactDuplicates: null,
  contactGroups: null,
  photos: null,
  photoDuplicates: null,
  albums: null,
  reminders: null,
  events: null,
  notifications: null,
  safariDownloads: null,
  safariScripts: null,
  appCache: null,
}

const META: Record<CleanerKind, { title: string; icon: string; tint: string; description: string }> = {
  contacts: { title: "联系人", icon: "person.crop.circle", tint: "systemBlue", description: "批量删除通讯录联系人" },
  contactDuplicates: { title: "联系人去重合并", icon: "person.2.badge.gearshape", tint: "systemGreen", description: "按姓名、电话或邮箱识别重复项，合并资料后删除副本" },
  contactGroups: { title: "联系人群组", icon: "person.3", tint: "systemIndigo", description: "删除不再使用的通讯录群组" },
  photos: { title: "照片与视频", icon: "photo.on.rectangle.angled", tint: "systemPink", description: "按类型和日期筛选后批量删除资源" },
  photoDuplicates: { title: "照片去重合并", icon: "photo.stack", tint: "systemGreen", description: "比较尺寸、时长和缩略图指纹，每组保留一项并删除其余副本" },
  albums: { title: "自建相册", icon: "rectangle.stack.badge.minus", tint: "systemPurple", description: "删除用户创建的相册，不删除其中照片" },
  reminders: { title: "提醒事项", icon: "checklist", tint: "systemOrange", description: "清理已完成、未完成或全部提醒事项" },
  events: { title: "日历事件", icon: "calendar.badge.minus", tint: "systemRed", description: "清理指定日期范围内的日历事件" },
  notifications: { title: "本地通知", icon: "bell.slash", tint: "systemTeal", description: "清除已送达或等待发送的本地通知" },
  safariDownloads: { title: "Safari 扩展下载", icon: "arrow.down.circle", tint: "systemBlue", description: "管理 Scripting Safari 扩展通过 GM.download 保存的文件，不是系统 Safari 下载" },
  safariScripts: { title: "Safari 用户脚本", icon: "safari", tint: "systemIndigo", description: "管理已安装的 .user.js/.js；这些是有效程序而非缓存，删除后对应网页功能将失效" },
  appCache: { title: "本脚本缓存", icon: "internaldrive", tint: "systemGray", description: "仅清理本脚本自己的设置数据和已登记的临时媒体，不触碰其他脚本或系统文件" },
}

const TEMP_MEDIA_KEY = "purebox_temp_media_paths"
const LEGACY_TEMP_MEDIA_KEY = "content_cleaner_temp_media_paths"
const PHOTO_PAGE_SIZE = 40
const PHOTO_MAX_ITEMS = 160
const PHOTO_THUMBNAIL_SIZE = 240
const PHOTO_PREVIEW_MAX_SIZE = 2048
const DUPLICATE_PHOTO_SCAN_LIMIT = 250
const SAFARI_SCAN_LIMIT = 2000
const MAX_CONTACT_DUPLICATE_GROUP_SIZE = 10

function registeredTempMedia(): string[] {
  const current = Storage.get<string[]>(TEMP_MEDIA_KEY)
  if (current) return current
  const legacy = Storage.get<string[]>(LEGACY_TEMP_MEDIA_KEY) || []
  if (legacy.length) {
    Storage.set(TEMP_MEDIA_KEY, legacy)
    Storage.remove(LEGACY_TEMP_MEDIA_KEY)
  }
  return legacy
}

function registerTempMedia(path: string): void {
  Storage.set(TEMP_MEDIA_KEY, [...new Set([...registeredTempMedia(), path])])
}

function unregisterTempMedia(path: string): void {
  const remaining = registeredTempMedia().filter(item => item !== path)
  if (remaining.length) Storage.set(TEMP_MEDIA_KEY, remaining)
  else Storage.remove(TEMP_MEDIA_KEY)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function contactName(contact: ContactInfo): string {
  return `${contact.familyName || ""}${contact.givenName || ""}`.trim() || contact.organizationName || "未命名联系人"
}

function dateText(value: number | Date | null | undefined): string {
  if (value == null) return "日期未知"
  const date = value instanceof Date ? value : new Date(value)
  return date.toLocaleDateString("zh-CN")
}

function mediaSubtitle(asset: PHAsset): string {
  const type = asset.mediaType === "video" ? `视频 · ${Math.round(asset.duration)} 秒` : "照片"
  return `${type} · ${asset.pixelWidth} × ${asset.pixelHeight} · ${dateText(asset.creationDate)}`
}

async function requestThumbnail(asset: PHAsset, pixelSize = PHOTO_THUMBNAIL_SIZE): Promise<UIImage | null> {
  try {
    return await asset.requestImage({
      // 240px 足以覆盖当前 68–82pt 缩略图，同时显著降低大量 UIImage 的常驻内存。
      targetWidth: pixelSize,
      targetHeight: pixelSize,
      contentMode: "aspectFill",
      deliveryMode: "highQualityFormat",
      version: "current",
      allowNetworkAccess: true,
    })
  } catch (error) {
    console.error(`缩略图读取失败: ${asset.localIdentifier}`, error)
    return null
  }
}

async function loadThumbnails(assets: PHAsset[]): Promise<(UIImage | null)[]> {
  const result: (UIImage | null)[] = []
  const batchSize = 6
  for (let index = 0; index < assets.length; index += batchSize) {
    result.push(...await Promise.all(assets.slice(index, index + batchSize).map(asset => requestThumbnail(asset))))
  }
  return result
}

function normalizedPhone(value: string | null | undefined): string {
  return (value || "").replace(/[^\d+]/g, "")
}

function duplicateContactGroups(contacts: ContactInfo[]): ContactInfo[][] {
  const parent = new Map<string, string>()
  const rank = new Map<string, number>()
  const byKey = new Map<string, string>()
  // 使用迭代式并查集，避免大量联系人命中同一号码时递归 find 导致栈溢出。
  const find = (id: string): string => {
    let root = id
    while ((parent.get(root) || root) !== root) root = parent.get(root)!
    let current = id
    while ((parent.get(current) || current) !== current) {
      const next = parent.get(current)!
      parent.set(current, root)
      current = next
    }
    return root
  }
  const union = (left: string, right: string) => {
    let a = find(left), b = find(right)
    if (a === b) return
    const rankA = rank.get(a) || 0
    const rankB = rank.get(b) || 0
    if (rankA < rankB) [a, b] = [b, a]
    parent.set(b, a)
    if (rankA === rankB) rank.set(a, rankA + 1)
  }
  for (const contact of contacts) {
    parent.set(contact.identifier, contact.identifier)
    rank.set(contact.identifier, 0)
  }
  for (const contact of contacts) {
    // 只把标准化电话或邮箱完全相同视为可自动合并；同名不能作为删除依据。
    const phoneKeys = (contact.phoneNumbers || []).flatMap(phone => {
      const value = normalizedPhone(phone.value)
      const digitCount = value.replace(/\D/g, "").length
      return digitCount >= 7 ? [`phone:${value}`] : []
    })
    const emailKeys = (contact.emailAddresses || []).flatMap(email => {
      const value = (email.value || "").trim().toLowerCase()
      return value.includes("@") && value.length >= 5 ? [`email:${value}`] : []
    })
    const keys = new Set([...phoneKeys, ...emailKeys])
    for (const key of keys) {
      const existing = byKey.get(key)
      if (existing) union(contact.identifier, existing)
      else byKey.set(key, contact.identifier)
    }
  }
  const groups = new Map<string, ContactInfo[]>()
  for (const contact of contacts) {
    const root = find(contact.identifier)
    const group = groups.get(root)
    if (group) group.push(contact)
    else groups.set(root, [contact])
  }
  // 超大连通组通常来自公司总机、家庭公共邮箱等共享资料，不应自动合并；
  // 同时限制一次更新携带的数据量，防止原生通讯录保存时长时间阻塞。
  return [...groups.values()].filter(group => group.length > 1 && group.length <= MAX_CONTACT_DUPLICATE_GROUP_SIZE)
}

function uniqueLabeled(values: ContactLabeledValue[], normalize: (value: string) => string): ContactLabeledValue[] {
  const seen = new Set<string>()
  return values.filter(item => {
    const key = normalize(item.value)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function mergeContactGroup(group: ContactInfo[]): Promise<void> {
  const [primary, ...duplicates] = group
  if (!primary) throw new Error("重复联系人组为空")
  const first = <T,>(values: (T | undefined)[]): T | undefined => values.find(value => value != null && (typeof value !== "string" || value.trim().length > 0))
  const optional = <T,>(key: string, value: T | undefined): Record<string, T> => value == null ? {} : { [key]: value }
  // 不读取或回写头像：一次把整本通讯录的 imageData 桥接到 JS 很容易造成内存峰值，
  // 且 updateContact 省略 imageData 时会保留主联系人的原头像。
  await Contact.updateContact({
    identifier: primary.identifier,
    ...optional("givenName", first(group.map(contact => contact.givenName))),
    ...optional("familyName", first(group.map(contact => contact.familyName))),
    ...optional("middleName", first(group.map(contact => contact.middleName))),
    ...optional("nickname", first(group.map(contact => contact.nickname))),
    ...optional("organizationName", first(group.map(contact => contact.organizationName))),
    ...optional("departmentName", first(group.map(contact => contact.departmentName))),
    ...optional("jobTitle", first(group.map(contact => contact.jobTitle))),
    ...optional("birthday", first(group.map(contact => contact.birthday))),
    dates: group.flatMap(contact => contact.dates || []),
    phoneNumbers: uniqueLabeled(group.flatMap(contact => contact.phoneNumbers || []), normalizedPhone),
    emailAddresses: uniqueLabeled(group.flatMap(contact => contact.emailAddresses || []), value => value.trim().toLowerCase()),
    urlAddresses: uniqueLabeled(group.flatMap(contact => contact.urlAddresses || []), value => value.trim().toLowerCase()),
    postalAddresses: group.flatMap(contact => contact.postalAddresses || []).filter((address, index, all) => all.findIndex(item => `${item.street}|${item.city}|${item.postalCode}` === `${address.street}|${address.city}|${address.postalCode}`) === index),
    socialProfiles: group.flatMap(contact => contact.socialProfiles || []),
    instantMessageAddresses: group.flatMap(contact => contact.instantMessageAddresses || []),
  })
  for (const duplicate of duplicates) await Contact.deleteContact(duplicate.identifier)
}

function photoMetadataKey(asset: PHAsset): string {
  return `${asset.mediaType}:${asset.pixelWidth}x${asset.pixelHeight}:${Math.round(asset.duration * 10)}`
}

async function photoFingerprint(asset: PHAsset): Promise<string | null> {
  const image = await asset.requestImage({ targetWidth: 16, targetHeight: 16, contentMode: "aspectFill", deliveryMode: "fastFormat", allowNetworkAccess: true })
  if (!image) return null
  const colors: string[] = []
  // 均匀采样整张 16×16 缩略图，而不是只取左上区域，降低不同照片误判为重复项的概率。
  for (let y = 1; y < 16; y += 2) {
    for (let x = 1; x < 16; x += 2) {
      const color = image.pixelColor(Math.min(x, Math.max(0, Math.round(image.width * image.scale) - 1)), Math.min(y, Math.max(0, Math.round(image.height * image.scale) - 1)))
      if (!color) return null
      colors.push(`${Math.round(color.red * 31)}-${Math.round(color.green * 31)}-${Math.round(color.blue * 31)}`)
    }
  }
  return `${photoMetadataKey(asset)}:${colors.join(".")}`
}

async function duplicatePhotoGroups(assets: PHAsset[]): Promise<PHAsset[][]> {
  const candidates = new Map<string, PHAsset[]>()
  for (const asset of assets) candidates.set(photoMetadataKey(asset), [...(candidates.get(photoMetadataKey(asset)) || []), asset])
  const fingerprints = new Map<string, PHAsset[]>()
  for (const group of candidates.values()) {
    if (group.length < 2) continue
    for (const asset of group) {
      const fingerprint = await photoFingerprint(asset)
      if (fingerprint) fingerprints.set(fingerprint, [...(fingerprints.get(fingerprint) || []), asset])
    }
  }
  return [...fingerprints.values()].filter(group => group.length > 1)
}

async function loadPhotoPage(photoType: string, limit: number): Promise<CleanItem[]> {
  const fetchOptions: PHFetchOptions = { sortBy: "creationDate", ascending: false, limit, includeHidden: false }
  if (photoType !== "all") fetchOptions.mediaType = photoType as "image" | "video"
  const assets = await Photos.fetchAssets(fetchOptions)
  const thumbnails = await loadThumbnails(assets)
  return assets.map((asset, index) => ({
    id: asset.localIdentifier,
    title: asset.mediaType === "video" ? "视频" : "照片",
    subtitle: mediaSubtitle(asset),
    raw: asset,
    thumbnail: thumbnails[index],
  }))
}

function fileName(path: string): string {
  return path.split("/").filter(Boolean).pop() || path
}

async function safariFiles(directory: string, scriptsOnly = false): Promise<CleanItem[]> {
  if (!await FileManager.exists(directory)) return []
  // 异步扫描并限制条目数，避免大目录的同步递归读取阻塞界面。
  const entries = (await FileManager.readDirectory(directory, true)).slice(0, SAFARI_SCAN_LIMIT)
  const items: CleanItem[] = []
  for (const entry of entries) {
    const path = entry.startsWith("/") ? entry : `${directory}/${entry}`
    if (!await FileManager.isFile(path) || (scriptsOnly && !/\.(user\.js|js)$/i.test(path))) continue
    const stat = await FileManager.stat(path)
    if (!scriptsOnly) {
      items.push({
        id: `safari-download:${path}`,
        title: fileName(path),
        subtitle: `${formatBytes(stat.size)} · ${dateText(stat.modificationDate)}`,
        raw: { type: "safariDownload", path },
      })
      continue
    }
    let source = ""
    // 用户脚本元数据位于文件头；超大脚本不在列表扫描阶段读入内存。
    if (stat.size <= 1024 * 1024) {
      try { source = await FileManager.readAsString(path) } catch {}
    }
    const metadata = (key: string) => source.match(new RegExp(`^\\s*//\\s*@${key}\\s+(.+)$`, "mi"))?.[1]?.trim() || ""
    items.push({
      id: `safari-script:${path}`,
      title: metadata("name") || fileName(path),
      subtitle: `${metadata("version") ? `v${metadata("version")} · ` : ""}${formatBytes(stat.size)} · ${metadata("description") || fileName(path)}`,
      raw: { type: "safariScript", path },
    })
  }
  return items
}

function loadAppCacheItems(): CleanItem[] {
  const items: CleanItem[] = []
  for (const path of registeredTempMedia()) {
    if (!FileManager.existsSync(path)) continue
    const stat = FileManager.statSync(path)
    items.push({ id: `temp:${path}`, title: "临时媒体文件", subtitle: `${formatBytes(stat.size)} · 可安全删除`, raw: { type: "temp", path } })
  }
  for (const key of Storage.keys()) {
    if (key === TEMP_MEDIA_KEY) continue
    items.push({ id: `storage:${key}`, title: key, subtitle: "本脚本 Storage 数据", raw: { type: "storage", key } })
  }
  return items
}

async function loadItems(kind: CleanerKind, options: { photoType: string; reminderScope: string; startDate: number; endDate: number }): Promise<CleanItem[]> {
  switch (kind) {
    case "contacts": {
      const contacts = await Contact.fetchAllContacts({ fetchImageData: false })
      return contacts.map(contact => ({
        id: contact.identifier,
        title: contactName(contact),
        subtitle: contact.phoneNumbers[0]?.value || contact.emailAddresses[0]?.value || contact.organizationName || "无电话或邮箱",
        raw: contact,
      }))
    }
    case "contactDuplicates": {
      // 去重只依赖电话和邮箱；不要批量读取头像，避免大通讯录因 imageData 内存峰值闪退。
      const groups = duplicateContactGroups(await Contact.fetchAllContacts({ fetchImageData: false }))
      return groups.map((group, index) => ({
        id: `contact-duplicate-${index}`,
        title: contactName(group[0]),
        subtitle: `${group.length} 个重复联系人 · 合并后保留 1 个`,
        raw: group,
      }))
    }
    case "contactGroups": {
      const groups = await Contact.fetchGroups()
      return groups.map(group => ({ id: group.identifier, title: group.name || "未命名群组", subtitle: "联系人群组", raw: group }))
    }
    case "photos":
      return loadPhotoPage(options.photoType, PHOTO_PAGE_SIZE)
    case "photoDuplicates": {
      const assets = await Photos.fetchAssets({ sortBy: "creationDate", ascending: false, limit: DUPLICATE_PHOTO_SCAN_LIMIT, includeHidden: false })
      const groups = await duplicatePhotoGroups(assets)
      // 分组顺序加载，避免重复项较多时同时解码大量 UIImage 导致内存峰值。
      const groupThumbnails: (UIImage | null)[][] = []
      for (const group of groups) groupThumbnails.push(await loadThumbnails(group))
      return groups.map((group, index) => ({
        id: `photo-duplicate-${index}`,
        title: group[0].mediaType === "video" ? "重复视频" : "重复照片",
        subtitle: `${group.length} 个相似副本 · ${group[0].pixelWidth} × ${group[0].pixelHeight} · 左侧第一项将保留`,
        raw: group,
        thumbnail: groupThumbnails[index][0],
        thumbnails: groupThumbnails[index],
      }))
    }
    case "albums": {
      const albums = await Photos.fetchAlbums({ type: "album" })
      return albums.map(album => ({ id: album.localIdentifier, title: album.title || "未命名相册", subtitle: `${album.estimatedAssetCount} 个项目`, raw: album }))
    }
    case "reminders": {
      const reminders = options.reminderScope === "completed"
        ? await Reminder.getCompleteds()
        : options.reminderScope === "incomplete"
          ? await Reminder.getIncompletes()
          : await Reminder.getAll()
      return reminders.map(reminder => ({
        id: reminder.identifier,
        title: reminder.title || "未命名提醒",
        subtitle: `${reminder.isCompleted ? "已完成" : "未完成"} · ${dateText(reminder.completionDate || reminder.dueDateComponents?.date)}`,
        raw: reminder,
      }))
    }
    case "events": {
      if (options.startDate > options.endDate) throw new Error("开始日期不能晚于结束日期")
      const inclusiveEnd = new Date(options.endDate)
      inclusiveEnd.setHours(23, 59, 59, 999)
      const events = await CalendarEvent.getAll(new Date(options.startDate), inclusiveEnd)
      return events.map(event => ({ id: event.identifier, title: event.title || "未命名事件", subtitle: `${dateText(event.startDate)} · ${event.calendar?.title || "日历"}`, raw: event }))
    }
    case "safariDownloads":
      return safariFiles(FileManager.safariBrowserDownloadsDirectory)
    case "safariScripts":
      return safariFiles(FileManager.safariBrowserUserscriptsDirectory, true)
    case "appCache":
      return loadAppCacheItems()
    case "notifications": {
      const [delivered, pending] = await Promise.all([Notification.getAllDelivereds(), Notification.getAllPendings()])
      return [
        ...delivered.map(info => ({ id: `delivered:${info.request.identifier}`, title: info.request.content.title || "无标题通知", subtitle: `已送达 · ${dateText(info.date)}`, raw: { scope: "delivered", identifier: info.request.identifier } })),
        ...pending.map(request => ({ id: `pending:${request.identifier}`, title: request.content.title || "无标题通知", subtitle: "等待发送", raw: { scope: "pending", identifier: request.identifier } })),
      ]
    }
  }
}

async function deleteItems(kind: CleanerKind, items: CleanItem[]): Promise<{ success: number; failed: number }> {
  let success = 0
  let failed = 0

  if (kind === "safariDownloads" || kind === "safariScripts") {
    for (const item of items) {
      try {
        if (FileManager.existsSync(item.raw.path)) FileManager.removeSync(item.raw.path)
        success += 1
      } catch (error) {
        console.error(`Safari 扩展文件删除失败: ${item.title}`, error)
        failed += 1
      }
    }
    return { success, failed }
  }

  if (kind === "appCache") {
    for (const item of items) {
      try {
        if (item.raw.type === "temp") {
          if (FileManager.existsSync(item.raw.path)) FileManager.removeSync(item.raw.path)
          unregisterTempMedia(item.raw.path)
        } else if (item.raw.type === "storage") {
          Storage.remove(item.raw.key)
        }
        success += 1
      } catch (error) {
        console.error(`缓存清理失败: ${item.title}`, error)
        failed += 1
      }
    }
    return { success, failed }
  }

  if (kind === "photoDuplicates") {
    const duplicates = items.flatMap(item => (item.raw as PHAsset[]).slice(1))
    try {
      const deleted = await Photos.deleteAssets(duplicates)
      return deleted ? { success: duplicates.length, failed: 0 } : { success: 0, failed: duplicates.length }
    } catch {
      return { success: 0, failed: duplicates.length }
    }
  }

  if (kind === "photos") {
    try {
      const deleted = await Photos.deleteAssets(items.map(item => item.raw as PHAsset))
      return deleted ? { success: items.length, failed: 0 } : { success: 0, failed: items.length }
    } catch {
      return { success: 0, failed: items.length }
    }
  }

  if (kind === "albums") {
    try {
      const deleted = await Photos.deleteAlbums(items.map(item => item.raw as PHAssetCollection))
      return deleted ? { success: items.length, failed: 0 } : { success: 0, failed: items.length }
    } catch {
      return { success: 0, failed: items.length }
    }
  }

  if (kind === "notifications") {
    const delivered = items.filter(item => item.raw.scope === "delivered").map(item => item.raw.identifier as string)
    const pending = items.filter(item => item.raw.scope === "pending").map(item => item.raw.identifier as string)
    try {
      if (delivered.length) await Notification.removeDelivereds(delivered)
      if (pending.length) await Notification.removePendings(pending)
      return { success: items.length, failed: 0 }
    } catch {
      return { success: 0, failed: items.length }
    }
  }

  for (const item of items) {
    try {
      if (kind === "contactDuplicates") await mergeContactGroup(item.raw as ContactInfo[])
      else if (kind === "contacts") await Contact.deleteContact(item.id)
      else if (kind === "contactGroups") await Contact.deleteGroup(item.id)
      else if (kind === "reminders") await (item.raw as Reminder).remove()
      else if (kind === "events") await (item.raw as CalendarEvent).remove()
      success += 1
    } catch (error) {
      console.error(`删除失败: ${item.title}`, error)
      failed += 1
    }
  }
  return { success, failed }
}

function NativeRow({ id, icon, tint, title, description, count, destination, namespace }: {
  id: string
  icon: string
  tint: string
  title: string
  description: string
  count: number | null
  destination: any
  namespace: NamespaceID
}) {
  return (
    <NavigationLink destination={destination} matchedTransitionSource={{ id, namespace }}>
      <HStack spacing={12} padding={{ vertical: 6 }}>
        <Image systemName={icon} foregroundStyle={tint as any} imageScale="large" frame={{ width: 34 }} />
        <VStack alignment="leading" spacing={3}>
          <Text font="body">{title}</Text>
          <Text font="caption" foregroundStyle="secondaryLabel">{description}</Text>
        </VStack>
        <Spacer />
        <Text foregroundStyle="secondaryLabel">{count == null ? "—" : count}</Text>
      </HStack>
    </NavigationLink>
  )
}

function HomePage({ overview, loading, onRefresh, namespace }: {
  overview: Overview
  loading: boolean
  onRefresh: () => Promise<void>
  namespace: NamespaceID
}) {
  const dismiss = Navigation.useDismiss()
  const destination = (kind: CleanerKind) => <CleanerPage kind={kind} onChanged={onRefresh} namespace={namespace} />
  return (
      <List
        navigationTitle="PureBox"
        navigationBarTitleDisplayMode="large"
        refreshable={onRefresh}
        toolbar={{
          topBarLeading: <Button title="刷新" action={onRefresh} disabled={loading} />,
          topBarTrailing: <Button action={dismiss} buttonStyle="borderless"><Image systemName="xmark.circle.fill" foregroundStyle="secondaryLabel" /></Button>,
        }}
      >
        {loading ? <Section><HStack spacing={10}><ProgressView /><Text foregroundStyle="secondaryLabel">正在统计可清理内容…</Text></HStack></Section> : null}
        <Section title="个人数据">
          <NativeRow id="contacts" {...META.contacts} count={overview.contacts} destination={destination("contacts")} namespace={namespace} />
          <NativeRow id="contactDuplicates" {...META.contactDuplicates} count={overview.contactDuplicates} destination={destination("contactDuplicates")} namespace={namespace} />
          <NativeRow id="contactGroups" {...META.contactGroups} count={overview.contactGroups} destination={destination("contactGroups")} namespace={namespace} />
        </Section>
        <Section title="照片图库">
          <NativeRow id="photos" {...META.photos} count={overview.photos} destination={destination("photos")} namespace={namespace} />
          <NativeRow id="photoDuplicates" {...META.photoDuplicates} count={overview.photoDuplicates} destination={destination("photoDuplicates")} namespace={namespace} />
          <NativeRow id="albums" {...META.albums} count={overview.albums} destination={destination("albums")} namespace={namespace} />
        </Section>
        <Section title="日程与通知">
          <NativeRow id="reminders" {...META.reminders} count={overview.reminders} destination={destination("reminders")} namespace={namespace} />
          <NativeRow id="events" {...META.events} count={overview.events} destination={destination("events")} namespace={namespace} />
          <NativeRow id="notifications" {...META.notifications} count={overview.notifications} destination={destination("notifications")} namespace={namespace} />
        </Section>
        <Section title="Safari 扩展">
          <NativeRow id="safariDownloads" {...META.safariDownloads} count={overview.safariDownloads} destination={destination("safariDownloads")} namespace={namespace} />
          <NativeRow id="safariScripts" {...META.safariScripts} count={overview.safariScripts} destination={destination("safariScripts")} namespace={namespace} />
        </Section>
        <Section title="本脚本数据">
          <NativeRow id="appCache" {...META.appCache} count={overview.appCache} destination={destination("appCache")} namespace={namespace} />
        </Section>
        <Section footer={<Text>删除操作不可由本脚本撤销。照片与相册删除时，iOS 会再次显示系统确认；照片可在“最近删除”中恢复。</Text>}>
          <HStack spacing={10}>
            <Image systemName="hand.raised.fill" foregroundStyle="systemBlue" />
            <Text foregroundStyle="secondaryLabel">所有读取和删除均由 iOS 原生 API 在本机完成。</Text>
          </HStack>
        </Section>
      </List>
  )
}

function MediaPreviewPage({ asset, thumbnail, namespace, transitionID }: {
  asset: PHAsset
  thumbnail?: UIImage | null
  namespace: NamespaceID
  transitionID: string
}) {
  const [image, setImage] = useState<UIImage | null>(asset.mediaType === "image" ? thumbnail || null : null)
  const [player, setPlayer] = useState<AVPlayer | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [scale, setScale] = useState(1)
  const [baseScale, setBaseScale] = useState(1)

  useEffect(() => {
    let active = true
    let createdPlayer: AVPlayer | null = null
    let videoPath: string | null = null

    const load = async () => {
      setLoading(true)
      setError("")
      try {
        if (asset.mediaType === "video") {
          videoPath = await asset.requestVideoURL({ version: "current", allowNetworkAccess: true })
          if (!videoPath) throw new Error("无法读取视频文件")
          if (!active) {
            if (FileManager.existsSync(videoPath)) FileManager.removeSync(videoPath)
            return
          }
          registerTempMedia(videoPath)
          createdPlayer = new AVPlayer()
          if (!createdPlayer.setSource(videoPath)) throw new Error("无法创建视频播放器")
          createdPlayer.onError = message => active && setError(message)
          setPlayer(createdPlayer)
          createdPlayer.play()
        } else {
          // 限制解码尺寸，避免 48MP、全景图等原图产生上百 MB 内存峰值。
          const original = await asset.requestImage({
            targetWidth: PHOTO_PREVIEW_MAX_SIZE,
            targetHeight: PHOTO_PREVIEW_MAX_SIZE,
            contentMode: "aspectFit",
            deliveryMode: "highQualityFormat",
            version: "current",
            allowNetworkAccess: true,
          })
          if (!active || !original) throw new Error("无法读取原图")
          setImage(original)
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "媒体加载失败")
      } finally {
        if (active) setLoading(false)
      }
    }

    load()
    return () => {
      active = false
      createdPlayer?.stop()
      createdPlayer?.dispose()
      if (videoPath && FileManager.existsSync(videoPath)) {
        try {
          FileManager.removeSync(videoPath)
          unregisterTempMedia(videoPath)
        } catch (error) { console.error("临时视频清理失败", error) }
      } else if (videoPath) {
        unregisterTempMedia(videoPath)
      }
    }
  }, [asset.localIdentifier])

  const magnify = MagnifyGesture(0.02)
    .onChanged(value => setScale(Math.max(1, Math.min(6, baseScale * value.magnification))))
    .onEnded(() => setBaseScale(scale))

  return (
    <VStack
      navigationTitle={asset.mediaType === "video" ? "视频预览" : "照片预览"}
      navigationBarTitleDisplayMode="inline"
      navigationTransition={{ type: "zoom", sourceID: transitionID, namespace }}
      background="black"
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      toolbar={{
        topBarTrailing: asset.mediaType === "image" && scale > 1
          ? <Button title="还原" action={() => { setScale(1); setBaseScale(1) }} />
          : undefined,
      }}
    >
      {loading ? (
        <VStack spacing={12} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
          <ProgressView />
          <Text foregroundStyle="white">正在载入{asset.mediaType === "video" ? "视频" : "原图"}…</Text>
        </VStack>
      ) : error ? (
        <ContentUnavailableView title="无法预览" systemImage="exclamationmark.triangle" description={error} />
      ) : asset.mediaType === "video" && player ? (
        <VideoPlayer player={player} frame={{ maxWidth: "infinity", maxHeight: "infinity" }} />
      ) : image ? (
        <ScrollView axes="all">
          <Image
            image={image}
            resizable={true}
            scaleToFit={true}
            interpolation="high"
            antialiased={true}
            scaleEffect={scale}
            gesture={magnify}
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          />
        </ScrollView>
      ) : null}
      <HStack padding={10} background="rgba(0,0,0,0.72)">
        <Text font="caption" foregroundStyle="white">{mediaSubtitle(asset)}</Text>
        <Spacer />
        {asset.isFavorite ? <Image systemName="heart.fill" foregroundStyle="systemRed" /> : null}
      </HStack>
    </VStack>
  )
}

function CleanerPage({ kind, onChanged, namespace }: { kind: CleanerKind; onChanged: () => void; namespace: NamespaceID }) {
  const meta = META[kind]
  const [items, setItems] = useState<CleanItem[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState("")
  const [photoType, setPhotoType] = useState("all")
  const [photoLimit, setPhotoLimit] = useState(PHOTO_PAGE_SIZE)
  const [loadingMore, setLoadingMore] = useState(false)
  const [reminderScope, setReminderScope] = useState("completed")
  const [startDate, setStartDate] = useState(Date.now() - 365 * 24 * 60 * 60 * 1000)
  const [endDate, setEndDate] = useState(Date.now() + 24 * 60 * 60 * 1000)
  const reloadGeneration = useRef(0)

  const reload = async () => {
    const generation = ++reloadGeneration.current
    setLoading(true)
    setError("")
    try {
      const result = kind === "photos"
        ? await loadPhotoPage(photoType, photoLimit)
        : await loadItems(kind, { photoType, reminderScope, startDate, endDate })
      if (generation !== reloadGeneration.current) return
      setItems(result)
      setSelected([])
    } catch (err) {
      if (generation !== reloadGeneration.current) return
      console.error(err)
      setItems([])
      setError(err instanceof Error ? err.message : "读取失败，请检查系统权限")
    } finally {
      if (generation === reloadGeneration.current) setLoading(false)
    }
  }

  useEffect(() => {
    reload()
    return () => { reloadGeneration.current += 1 }
  }, [kind, photoType, photoLimit, reminderScope, startDate, endDate])

  const loadMorePhotos = async () => {
    if (kind !== "photos" || loadingMore || loading || items.length < photoLimit || photoLimit >= PHOTO_MAX_ITEMS) return
    setLoadingMore(true)
    setPhotoLimit(previous => Math.min(PHOTO_MAX_ITEMS, previous + PHOTO_PAGE_SIZE))
  }

  useEffect(() => {
    if (!loading) setLoadingMore(false)
  }, [loading])

  const toggle = (id: string, value: boolean) => {
    setSelected(previous => value ? [...previous, id] : previous.filter(value => value !== id))
  }

  const isSelectable = (item: CleanItem): boolean => {
    if (kind === "photos") return item.thumbnail != null
    if (kind === "photoDuplicates") {
      const assets = item.raw as PHAsset[]
      return assets.length > 1 && (item.thumbnails?.length || 0) === assets.length && item.thumbnails!.every(image => image != null)
    }
    return true
  }
  const selectableItems = items.filter(isSelectable)

  const performDelete = async () => {
    const targets = items.filter(item => selected.includes(item.id) && isSelectable(item))
    if (!targets.length) {
      await Dialog.alert({ title: "没有可安全处理的项目", message: "照片必须成功显示全部缩略图后才能删除。" })
      return
    }
    const isMerge = kind === "contactDuplicates" || kind === "photoDuplicates"
    const isAppCache = kind === "appCache"
    const isSafari = kind === "safariDownloads" || kind === "safariScripts"
    const affected = kind === "photoDuplicates" ? targets.reduce((sum, item) => sum + Math.max(0, (item.raw as PHAsset[]).length - 1), 0) : targets.length
    const confirmed = await Dialog.confirm({
      title: isMerge ? `处理 ${targets.length} 组重复项` : isAppCache ? `清理 ${targets.length} 项本脚本数据` : isSafari ? `${kind === "safariScripts" ? "卸载" : "删除"} ${targets.length} 项` : `删除 ${targets.length} 项${meta.title}`,
      message: kind === "contactDuplicates"
        ? "每组将保留第一个联系人，合并电话、邮箱、地址等资料，然后删除其余联系人。操作不可撤销。"
        : kind === "photoDuplicates"
          ? `每组将保留最新一项，并删除共 ${affected} 个重复副本。照片可在“最近删除”中恢复。`
          : isAppCache
            ? "只会删除本脚本 Storage 数据和已登记的临时媒体，不会触碰系统或其他脚本文件。"
            : kind === "safariScripts"
              ? "这些文件是已安装的有效用户脚本，不是缓存。删除后对应网页功能将立即失效，确定继续吗？"
              : kind === "safariDownloads"
                ? "只会删除 Scripting Safari 扩展的下载文件，不会清除系统 Safari 历史记录或网站数据。"
                : "此操作不可由脚本撤销，确定继续吗？",
      confirmLabel: isMerge ? "去重合并" : isAppCache ? "清理" : kind === "safariScripts" ? "卸载脚本" : "删除",
      cancelLabel: "取消",
    })
    if (!confirmed) return
    setDeleting(true)
    try {
      const result = await deleteItems(kind, targets)
      await Dialog.alert({ title: kind === "contactDuplicates" || kind === "photoDuplicates" ? "去重完成" : "清理完成", message: `成功处理 ${result.success} 项，失败 ${result.failed} 项` })
      await reload()
      onChanged()
    } catch (err) {
      console.error("批量处理失败", err)
      await Dialog.alert({ title: "处理失败", message: err instanceof Error ? err.message : "发生未知错误，请稍后重试" })
    } finally {
      setDeleting(false)
    }
  }

  const photoThumbnail = (image: UIImage | null | undefined, asset?: PHAsset, size = 64) => (
    <ZStack alignment="bottomTrailing" frame={{ width: size, height: size }} clipShape={{ type: "rect", cornerRadius: 10 }} background="secondarySystemBackground">
      {image
        ? <Image image={image} resizable={true} scaleToFill={true} interpolation="high" antialiased={true} frame={{ width: size, height: size }} clipped={true} />
        : <Image systemName="photo" foregroundStyle="tertiaryLabel" imageScale="large" />}
      {asset?.mediaType === "video" ? (
        <HStack spacing={3} padding={4} background="rgba(0,0,0,0.58)" clipShape="capsule">
          <Image systemName="play.fill" foregroundStyle="white" imageScale="small" />
          <Text font="caption2" foregroundStyle="white">{Math.round(asset.duration)}s</Text>
        </HStack>
      ) : null}
    </ZStack>
  )

  const itemLabel = (item: CleanItem) => {
    if (kind === "photos") {
      return (
        <HStack spacing={12}>
          <NavigationLink
            destination={<MediaPreviewPage asset={item.raw as PHAsset} thumbnail={item.thumbnail} namespace={namespace} transitionID={`media-${item.id}`} />}
            matchedTransitionSource={{ id: `media-${item.id}`, namespace }}
          >
            {photoThumbnail(item.thumbnail, item.raw as PHAsset, 68)}
          </NavigationLink>
          <VStack alignment="leading" spacing={4}>
            <Text>{item.title}</Text>
            <Text font="caption" foregroundStyle="secondaryLabel">{item.subtitle}</Text>
            {item.thumbnail ? null : <Text font="caption2" foregroundStyle="systemOrange">缩略图暂不可用，请勿盲目删除</Text>}
          </VStack>
        </HStack>
      )
    }
    if (kind === "photoDuplicates") {
      const assets = item.raw as PHAsset[]
      return (
        <VStack alignment="leading" spacing={8}>
          <HStack><Text>{item.title}</Text><Spacer /><Text font="caption" foregroundStyle="secondaryLabel">{assets.length} 项</Text></HStack>
          <ScrollView axes="horizontal">
            <HStack spacing={8}>
              {assets.map((asset, index) => (
                <VStack key={asset.localIdentifier} spacing={3}>
                  <NavigationLink
                    destination={<MediaPreviewPage asset={asset} thumbnail={item.thumbnails?.[index]} namespace={namespace} transitionID={`media-${asset.localIdentifier}`} />}
                    matchedTransitionSource={{ id: `media-${asset.localIdentifier}`, namespace }}
                  >
                    {photoThumbnail(item.thumbnails?.[index], asset, 82)}
                  </NavigationLink>
                  <Text font="caption2" foregroundStyle={index === 0 ? "systemGreen" : "systemRed"}>{index === 0 ? "保留" : "删除"}</Text>
                </VStack>
              ))}
            </HStack>
          </ScrollView>
          <Text font="caption" foregroundStyle="secondaryLabel">{item.subtitle}</Text>
        </VStack>
      )
    }
    if (kind === "safariDownloads" || kind === "safariScripts") {
      return (
        <HStack spacing={10}>
          <Image systemName={kind === "safariScripts" ? "doc.text.magnifyingglass" : "doc"} foregroundStyle={kind === "safariScripts" ? "systemIndigo" : "systemBlue"} />
          <VStack alignment="leading" spacing={3}>
            <Text>{item.title}</Text>
            <Text font="caption" foregroundStyle="secondaryLabel">{item.subtitle}</Text>
          </VStack>
          <Spacer />
          <Button title="预览" systemImage="eye" action={() => QuickLook.previewURLs([item.raw.path], true)} buttonStyle="borderless" />
        </HStack>
      )
    }
    return (
      <VStack alignment="leading" spacing={3}>
        <Text>{item.title}</Text>
        <Text font="caption" foregroundStyle="secondaryLabel">{item.subtitle}</Text>
      </VStack>
    )
  }

  const filters = kind === "photos" ? (
    <Section title="筛选">
      <Picker title="媒体类型" value={photoType} onChanged={setPhotoType} pickerStyle="menu">
        <Text tag="all">全部</Text><Text tag="image">照片</Text><Text tag="video">视频</Text>
      </Picker>
      <Text foregroundStyle="secondaryLabel">每次加载 {PHOTO_PAGE_SIZE} 项缩略图，本页最多保留 {PHOTO_MAX_ITEMS} 项，以避免内存过高导致闪退。</Text>
    </Section>
  ) : kind === "reminders" ? (
    <Section title="筛选">
      <Picker title="提醒状态" value={reminderScope} onChanged={setReminderScope} pickerStyle="segmented">
        <Text tag="completed">已完成</Text><Text tag="incomplete">未完成</Text><Text tag="all">全部</Text>
      </Picker>
    </Section>
  ) : kind === "events" ? (
    <Section title="日期范围">
      <DatePicker title="开始日期" value={startDate} onChanged={setStartDate} displayedComponents={["date"]} />
      <DatePicker title="结束日期" value={endDate} onChanged={setEndDate} displayedComponents={["date"]} />
    </Section>
  ) : null

  return (
      <List
        navigationTitle={meta.title}
        navigationBarTitleDisplayMode="inline"
        navigationTransition={{ type: "zoom", sourceID: kind, namespace }}
        refreshable={reload}
        overlay={!loading && !items.length ? <ContentUnavailableView title={error || "没有可清理内容"} systemImage={error ? "exclamationmark.triangle" : "checkmark.circle"} description={error ? "请授予对应系统权限后重试" : "当前筛选条件下没有项目"} /> : undefined}
        toolbar={{
          topBarTrailing: <Button title={selected.length === selectableItems.length && selectableItems.length ? "取消全选" : "全选"} action={() => setSelected(selected.length === selectableItems.length ? [] : selectableItems.map(item => item.id))} disabled={loading || !selectableItems.length || deleting} />,
          bottomBar: <Button title={deleting ? "正在处理…" : kind === "contactDuplicates" || kind === "photoDuplicates" ? `去重合并（${selected.length} 组）` : kind === "appCache" ? `清理所选（${selected.length}）` : kind === "safariScripts" ? `卸载所选（${selected.length}）` : `删除所选（${selected.length}）`} systemImage={kind === "contactDuplicates" || kind === "photoDuplicates" ? "arrow.triangle.merge" : kind === "appCache" ? "internaldrive" : "trash"} role="destructive" action={performDelete} disabled={!selected.length || deleting} />,
        }}
      >
        <Section footer={<Text>{meta.description}</Text>}>
          <HStack spacing={10}>
            <Image systemName={meta.icon} foregroundStyle={meta.tint as any} imageScale="large" />
            <Text>{items.length} 个项目</Text>
            <Spacer />
            {loading || deleting ? <ProgressView /> : null}
          </HStack>
        </Section>
        {filters}
        {items.length ? (
          <Section title={kind === "contactDuplicates" || kind === "photoDuplicates" ? "选择要处理的重复组" : "选择要删除的项目"}>
            {items.map(item => (
              <Toggle key={item.id} value={selected.includes(item.id)} onChanged={value => toggle(item.id, value)} disabled={!isSelectable(item)}>
                {itemLabel(item)}
              </Toggle>
            ))}
          </Section>
        ) : null}
        {kind === "photos" && items.length >= photoLimit && photoLimit < PHOTO_MAX_ITEMS ? (
          <Section>
            <Button title={loadingMore ? "正在加载…" : `继续加载 ${PHOTO_PAGE_SIZE} 项`} systemImage="arrow.down.circle" action={loadMorePhotos} disabled={loadingMore || loading} />
          </Section>
        ) : null}
      </List>
  )
}

function App() {
  const [overview, setOverview] = useState<Overview>(EMPTY_OVERVIEW)
  const [loading, setLoading] = useState(true)
  const overviewGeneration = useRef(0)
  const overviewRunning = useRef(false)

  const refreshOverview = async () => {
    if (overviewRunning.current) return
    overviewRunning.current = true
    const generation = ++overviewGeneration.current
    setLoading(true)
    const next: Overview = { ...EMPTY_OVERVIEW }
    const safeCount = async (loader: () => Promise<unknown[]>): Promise<number | null> => {
      try { return (await loader()).length } catch (error) { console.error("统计读取失败", error); return null }
    }
    try {
      // 原生资料库读取按顺序执行，避免通讯录、照片、日历等同时桥接大量对象造成卡死。
      try {
        const contacts = await Contact.fetchAllContacts({ fetchImageData: false })
        next.contacts = contacts.length
        next.contactDuplicates = duplicateContactGroups(contacts).length
      } catch (error) { console.error("联系人统计失败", error) }
      next.contactGroups = await safeCount(() => Contact.fetchGroups())
      // Photos 暂无轻量 count API；首页不再 fetchAssets({ limit: 0 }) 拉取整个图库。
      // 进入照片页面后仍按 50 项分页加载。
      next.photos = null
      next.photoDuplicates = null
      next.albums = await safeCount(() => Photos.fetchAlbums({ type: "album" }))
      next.reminders = await safeCount(() => Reminder.getAll())
      const start = new Date(new Date().getFullYear() - 1, 0, 1)
      const end = new Date(new Date().getFullYear() + 1, 0, 1)
      next.events = await safeCount(() => CalendarEvent.getAll(start, end))
      try {
        const delivered = await Notification.getAllDelivereds()
        const pending = await Notification.getAllPendings()
        next.notifications = delivered.length + pending.length
      } catch (error) { console.error("通知统计失败", error) }
      // Safari 目录可能非常大：首页不递归扫描，进入对应页面时再异步读取。
      next.safariDownloads = null
      next.safariScripts = null
      next.appCache = loadAppCacheItems().length
      if (generation === overviewGeneration.current) setOverview(next)
    } catch (error) {
      console.error("首页统计刷新失败", error)
    } finally {
      overviewRunning.current = false
      if (generation === overviewGeneration.current) setLoading(false)
    }
  }

  useEffect(() => {
    refreshOverview()
    return () => { overviewGeneration.current += 1 }
  }, [])

  return (
    <NamespaceReader>
      {namespace => (
        <NavigationStack>
          <HomePage overview={overview} loading={loading} onRefresh={refreshOverview} namespace={namespace} />
        </NavigationStack>
      )}
    </NamespaceReader>
  )
}

async function run() {
  Script.enableMinimize()
  try {
    await Navigation.present({ element: <App />, modalPresentationStyle: "fullScreen" })
  } finally {
    Script.exit()
  }
}

run()

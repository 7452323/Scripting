/**
 * ContactRow - Avatar display, swipe left for delete + change avatar, checkbox for batch mode
 */

import { Text, HStack, VStack, Image, Button, Spacer } from 'scripting'
import { DisplayContact } from '../models/Contact'

interface ContactRowProps {
  contact: DisplayContact
  selected?: boolean
  selectionMode?: boolean
  onTap?: () => void
  onLongPress?: () => void
  onDelete?: () => void
  onChangeAvatar?: () => void
}

export function ContactRow({ contact, selected, selectionMode, onTap, onLongPress, onDelete, onChangeAvatar }: ContactRowProps) {
  // 尝试从 imageData 创建头像，并缩放到合适大小
  let avatar: UIImage | null = null
  if (contact.imageData) {
    try {
      const originalImage = UIImage.fromData(contact.imageData)
      if (originalImage) {
        // 缩放到 80x80（2x for retina）确保清晰度
        avatar = originalImage.preparingThumbnail({ width: 80, height: 80 })
        if (!avatar) avatar = originalImage
      }
    } catch (e) {
      // 如果失败，尝试作为 base64 字符串处理
      try {
        const base64 = contact.imageData.toBase64String?.()
        if (base64) {
          const originalImage = UIImage.fromBase64String(base64)
          if (originalImage) {
            avatar = originalImage.preparingThumbnail({ width: 80, height: 80 })
            if (!avatar) avatar = originalImage
          }
        }
      } catch (e2) {
        // 忽略错误
      }
    }
  }

  return (
    <HStack
      spacing={12}
      padding={{ top: 8, bottom: 8, leading: 16, trailing: 16 }}
      onTapGesture={onTap}
      trailingSwipeActions={{
        allowsFullSwipe: true,
        actions: [
          ...(onDelete ? [<Button title="删除" role="destructive" action={onDelete} />] : []),
          ...(onChangeAvatar ? [<Button title="改图" tint="#007AFF" action={onChangeAvatar} />] : []),
        ]
      }}
    >
      {/* Avatar - real photo or fallback icon */}
      {avatar ? (
        <Image
          image={avatar}
          resizable={true}
          scaleToFill={true}
          frame={{ width: 40, height: 40 }}
          clipShape="circle"
        />
      ) : (
        <Image
          systemName="person.circle.fill"
          foregroundStyle="#999"
          imageScale="large"
        />
      )}

      {/* Info */}
      <VStack alignment="leading" spacing={2}>
        <Text font="headline" foregroundStyle="label">
          {contact.fullName}
        </Text>
        {contact.phone ? (
          <HStack spacing={4}>
            <Image systemName="phone.fill" imageScale="small" foregroundStyle="secondaryLabel" />
            <Text font="subheadline" foregroundStyle="secondaryLabel">{contact.phone}</Text>
          </HStack>
        ) : null}
        {contact.email ? (
          <HStack spacing={4}>
            <Image systemName="envelope.fill" imageScale="small" foregroundStyle="secondaryLabel" />
            <Text font="caption" foregroundStyle="tertiaryLabel">{contact.email}</Text>
          </HStack>
        ) : null}
        {contact.organization ? (
          <HStack spacing={4}>
            <Image systemName="building.2.fill" imageScale="small" foregroundStyle="secondaryLabel" />
            <Text font="caption" foregroundStyle="tertiaryLabel">{contact.organization}</Text>
          </HStack>
        ) : null}
      </VStack>

      {/* Spacer pushes checkbox to far right */}
      <Spacer />

      {/* Right side: chevron or checkbox */}
      {selectionMode ? (
        <Image
          systemName={selected ? "checkmark.circle.fill" : "circle"}
          imageScale="medium"
          foregroundStyle={selected ? "#007AFF" : "systemGray3"}
        />
      ) : (
        <Image systemName="chevron.right" imageScale="small" foregroundStyle="tertiaryLabel" />
      )}
    </HStack>
  )
}
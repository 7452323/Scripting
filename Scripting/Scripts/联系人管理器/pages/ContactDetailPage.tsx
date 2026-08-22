/**
 * ContactDetailPage - View and edit a single contact
 */

import { useState } from 'scripting'
import {
  Navigation, NavigationStack, List, Section, Text, VStack, HStack,
  TextField, Button, Image
} from 'scripting'
import { requestContactsPermission } from '../utils/Permissions'
import { ContactInfo } from '../models/Contact'
import { getFullName } from '../utils/Helpers'

interface ContactDetailPageProps {
  contact: ContactInfo
  onSave: () => void
  onDelete: () => void
  onBack: () => void
}

export function ContactDetailPage({ contact, onSave, onDelete, onBack }: ContactDetailPageProps) {
  const [givenName, setGivenName] = useState(contact.givenName || '')
  const [familyName, setFamilyName] = useState(contact.familyName || '')
  const [organization, setOrganization] = useState(contact.organizationName || '')
  const [saving, setSaving] = useState(false)

  const fullName = [familyName, givenName].filter(Boolean).join(' ') || '新联系人'

  // Save handler
  const handleSave = async () => {
    setSaving(true)
    try {
      await Contact.updateContact({
        identifier: contact.identifier,
        givenName,
        familyName,
        phoneNumbers: contact.phoneNumbers,
        emailAddresses: contact.emailAddresses,
        postalAddresses: contact.postalAddresses,
        organizationName: organization,
        jobTitle: contact.jobTitle,
      })
      onSave()
    } catch {
      await Dialog.alert({ title: '保存失败', message: '请检查输入内容' })
    }
    setSaving(false)
  }

  // Delete handler
  const handleDelete = async () => {
    const confirmed = await Dialog.confirm({
      title: '删除联系人',
      message: `确定要删除 ${fullName} 吗？此操作不可撤销。`,
      confirmLabel: '删除',
      cancelLabel: '取消',
    })
    if (!confirmed) return

    try {
      await Contact.deleteContact(contact.identifier!)
      onDelete()
    } catch {
      await Dialog.alert({ title: '删除失败', message: '无法删除此联系人' })
    }
  }

  const dismiss = Navigation.useDismiss()

  return (
    <NavigationStack statusBarHidden persistentSystemOverlays="hidden">
      <List navigationTitle={fullName} navigationBarTitleDisplayMode="inline"
        toolbar={{
          topBarLeading: (
            <Button action={onBack} buttonStyle="borderless">
              <HStack spacing={4}>
                <Image systemName="chevron.left" imageScale="small" foregroundStyle="systemBlue" />
                <Text font="subheadline" foregroundStyle="systemBlue">返回</Text>
              </HStack>
            </Button>
          ),
          topBarTrailing: (
            <Button action={dismiss} buttonStyle="borderless"><Image systemName="xmark.circle.fill" imageScale="medium" foregroundStyle="systemGray" /></Button>
          ),
        }}
      >
        <Section>
          <VStack alignment="center" spacing={8} padding={{ top: 16, bottom: 16 }}>
            <Image systemName="person.crop.circle.fill" imageScale="large" foregroundStyle="#007AFF" />
            <Text font="title2" fontWeight="semibold">{fullName}</Text>
          </VStack>
        </Section>

        <Section header={<Text>姓名</Text>}>

          <TextField title="姓" value={familyName} onChanged={setFamilyName} prompt="姓氏" />
          <TextField title="名" value={givenName} onChanged={setGivenName} prompt="名字" />
        </Section>

        <Section header={<Text>工作</Text>}>

          <TextField title="公司" value={organization} onChanged={setOrganization} prompt="公司或组织" />
        </Section>

        {contact.phoneNumbers?.length > 0 && (
          <Section header={<Text>电话</Text>}>

            {contact.phoneNumbers.map((phone: { label: string; value: string }, i: number) => (
              <HStack key={i} spacing={8}>
                <Text font="caption" foregroundStyle="secondaryLabel">{phone.label}</Text>
                <Text font="body">{phone.value}</Text>
              </HStack>
            ))}
          </Section>
        )}

        {contact.emailAddresses?.length > 0 && (
          <Section header={<Text>邮箱</Text>}>

            {contact.emailAddresses.map((email: { label: string; value: string }, i: number) => (
              <HStack key={i} spacing={8}>
                <Text font="caption" foregroundStyle="secondaryLabel">{email.label}</Text>
                <Text font="body">{email.value}</Text>
              </HStack>
            ))}
          </Section>
        )}

        <Section>
          <Button title="保存" action={handleSave} buttonStyle="borderedProminent" />
          <Button title="删除联系人" action={handleDelete} role="destructive" buttonStyle="bordered" />
        </Section>
      </List>
    </NavigationStack>
  )
}

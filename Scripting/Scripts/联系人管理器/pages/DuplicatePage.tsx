/**
 * DuplicatePage - Find and merge duplicate contacts
 */

import { useState } from 'scripting'
import {
  Navigation, NavigationStack, List, Section, Text, VStack, HStack,
  Button, Image, ContentUnavailableView
} from 'scripting'
import { ContactInfo, DuplicateGroup } from '../models/Contact'
import { findAllDuplicates, mergeDuplicateContacts, getDuplicateContactCount } from '../services/DuplicateService'
import { getFullName, getPrimaryPhone } from '../utils/Helpers'

interface DuplicatePageProps {
  contacts: ContactInfo[]
  onComplete: () => void
  onBack: () => void
}

export function DuplicatePage({ contacts, onComplete, onBack }: DuplicatePageProps) {
  const [groups, setGroups] = useState<DuplicateGroup[]>(() => findAllDuplicates(contacts))
  const [merging, setMerging] = useState(false)
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)

  // Merge a single group
  const handleMerge = async (group: DuplicateGroup) => {
    setMerging(true)
    try {
      const merged = mergeDuplicateContacts(group)
      await Contact.updateContact({
        identifier: merged.identifier,
        givenName: merged.givenName,
        familyName: merged.familyName,
        phoneNumbers: merged.phoneNumbers,
        emailAddresses: merged.emailAddresses,
        postalAddresses: merged.postalAddresses,
        organizationName: merged.organizationName,
        jobTitle: merged.jobTitle,
      })
      const duplicates = group.contacts.filter((c: ContactInfo) => c.identifier !== merged.identifier)
      for (const dup of duplicates) {
        await Contact.deleteContact(dup.identifier)
      }
      const remaining = contacts.filter((c: ContactInfo) => !duplicates.find((d: ContactInfo) => d.identifier === c.identifier))
      setGroups(findAllDuplicates(remaining))
      onComplete()
      await Dialog.alert({ title: '合并完成', message: `已合并 ${group.contacts.length} 个联系人为 1 个` })
    } catch {
      await Dialog.alert({ title: '合并失败', message: '请稍后重试' })
    }
    setMerging(false)
  }

  // Merge all
  const handleMergeAll = async () => {
    if (groups.length === 0) return
    const confirmed = await Dialog.confirm({
      title: '全部合并',
      message: `将合并所有 ${groups.length} 组重复联系人，共 ${getDuplicateContactCount(groups)} 个。是否继续？`,
      confirmLabel: '全部合并',
      cancelLabel: '取消',
    })
    if (!confirmed) return

    setMerging(true)
    let mergedCount = 0
    for (const group of groups) {
      try {
        const merged = mergeDuplicateContacts(group)
        await Contact.updateContact({
          identifier: merged.identifier,
          givenName: merged.givenName,
          familyName: merged.familyName,
          phoneNumbers: merged.phoneNumbers,
          emailAddresses: merged.emailAddresses,
          postalAddresses: merged.postalAddresses,
          organizationName: merged.organizationName,
          jobTitle: merged.jobTitle,
        })
        const duplicates = group.contacts.filter((c: ContactInfo) => c.identifier !== merged.identifier)
        for (const dup of duplicates) {
          await Contact.deleteContact(dup.identifier)
        }
        mergedCount++
      } catch { /* skip */ }
    }
    setGroups([])
    onComplete()
    setMerging(false)
    await Dialog.alert({ title: '合并完成', message: `成功合并 ${mergedCount} 组` })
  }

  const dismiss = Navigation.useDismiss()

  if (groups.length === 0) {
    return (
      <NavigationStack statusBarHidden persistentSystemOverlays="hidden">
        <List navigationTitle="重复联系人" navigationBarTitleDisplayMode="inline"
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
            <ContentUnavailableView
              title="未发现重复"
              systemImage="checkmark.circle.fill"
              description="您的通讯录中没有重复的联系人"
            />
          </Section>
        </List>
      </NavigationStack>
    )
  }

  return (
    <NavigationStack statusBarHidden persistentSystemOverlays="hidden">
      <List navigationTitle="重复联系人" navigationBarTitleDisplayMode="inline"
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
          <VStack spacing={8} padding={{ leading: 16, trailing: 16, top: 8, bottom: 8 }}>
            <Text font="subheadline" foregroundStyle="secondaryLabel">
              发现 {groups.length} 组重复，共 {getDuplicateContactCount(groups)} 个联系人
            </Text>
            <Button title="一键合并全部" action={handleMergeAll} disabled={merging} buttonStyle="borderedProminent" />
          </VStack>
        </Section>

        {groups.map((group: DuplicateGroup, gIndex: number) => (
          <Section key={gIndex} header={<Text font="footnote" foregroundStyle="secondaryLabel">{group.reason}</Text>}>
            <Button
              action={() => setExpandedGroup(expandedGroup === group.key ? null : group.key)}
              buttonStyle="borderless"
            >
              <HStack>
                <VStack alignment="leading" spacing={2}>
                  <Text font="headline">{getFullName(group.contacts[0])}</Text>
                  <Text font="caption" foregroundStyle="secondaryLabel">
                    {group.contacts.length} 个重复项 · {getPrimaryPhone(group.contacts[0]) || '无电话'}
                  </Text>
                </VStack>
                <Image
                  systemName={expandedGroup === group.key ? "chevron.up" : "chevron.down"}
                  imageScale="small"
                  foregroundStyle="tertiaryLabel"
                />
              </HStack>
            </Button>

            {expandedGroup === group.key && (
              <VStack spacing={4}>
                {group.contacts.map((contact: ContactInfo, cIndex: number) => (
                  <HStack
                    key={contact.identifier}
                    spacing={8}
                    padding={{ top: 4, bottom: 4, leading: 16, trailing: 16 }}
                    background={cIndex === 0 ? "rgba(0,122,255,0.08)" : undefined}
                  >
                    <Image
                      systemName={cIndex === 0 ? "checkmark.circle.fill" : "circle"}
                      imageScale="small"
                      foregroundStyle={cIndex === 0 ? "#007AFF" : "systemGray3"}
                    />
                    <VStack alignment="leading" spacing={1}>
                      <Text font="subheadline">
                        {getFullName(contact)}{cIndex === 0 ? " (保留)" : ""}
                      </Text>
                      {contact.phoneNumbers?.map((p: { value: string }, pi: number) => (
                        <Text key={pi} font="caption2" foregroundStyle="secondaryLabel">{p.value}</Text>
                      ))}
                    </VStack>
                  </HStack>
                ))}
                <HStack padding={{ leading: 16, trailing: 16, bottom: 8 }}>
                  <Button title="合并此组" action={() => handleMerge(group)} disabled={merging} buttonStyle="bordered" />
                </HStack>
              </VStack>
            )}
          </Section>
        ))}
      </List>
    </NavigationStack>
  )
}

/**
 * BackupPage - Manage contact backups and restore
 */

import { useState, useEffect } from 'scripting'
import {
  Navigation, NavigationStack, List, Section, Text, VStack, HStack,
  Button, Image, ContentUnavailableView
} from 'scripting'
import { ContactInfo, BackupMeta } from '../models/Contact'
import { createBackup, listBackups, deleteBackup, restoreFromBackup, exportToVCard } from '../services/BackupService'
import { formatDate } from '../utils/Helpers'

interface BackupPageProps {
  contacts: ContactInfo[]
  onBack: () => void
}

export function BackupPage({ contacts, onBack }: BackupPageProps) {
  const [backups, setBackups] = useState<BackupMeta[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    loadBackups()
  }, [])

  const loadBackups = async () => {
    const list = await listBackups()
    setBackups(list)
  }

  // Create backup
  const handleCreateBackup = async () => {
    setLoading(true)
    try {
      const meta = await createBackup()
      await loadBackups()
      await Dialog.alert({ title: '备份成功', message: `已备份 ${meta.count} 个联系人` })
    } catch {
      await Dialog.alert({ title: '备份失败', message: '请稍后重试' })
    }
    setLoading(false)
  }

  // Restore backup
  const handleRestore = async (meta: BackupMeta) => {
    const confirmed = await Dialog.confirm({
      title: '恢复备份',
      message: `将恢复 ${meta.count} 个联系人。这不会删除现有联系人。`,
      confirmLabel: '恢复',
      cancelLabel: '取消',
    })
    if (!confirmed) return

    setLoading(true)
    try {
      const result = await restoreFromBackup(meta.fileName)
      await Dialog.alert({ title: '恢复完成', message: `成功创建 ${result.created} 个，失败 ${result.failed} 个` })
    } catch {
      await Dialog.alert({ title: '恢复失败', message: '备份文件可能已损坏' })
    }
    setLoading(false)
  }

  // Delete backup
  const handleDeleteBackup = async (meta: BackupMeta) => {
    const confirmed = await Dialog.confirm({
      title: '删除备份',
      message: '确定要删除此备份吗？',
      confirmLabel: '删除',
      cancelLabel: '取消',
    })
    if (!confirmed) return
    await deleteBackup(meta.fileName)
    await loadBackups()
  }

  // Export vCard
  const handleExportVCard = async () => {
    setLoading(true)
    try {
      const vcard = exportToVCard(contacts)
      const fileName = `contacts_${Date.now()}.vcf`
      const filePath = `${FileManager.documentsDirectory}/${fileName}`
      await FileManager.writeAsString(filePath, vcard)
      await QuickLook.previewURLs([filePath])
    } catch {
      await Dialog.alert({ title: '导出失败', message: '无法导出 vCard' })
    }
    setLoading(false)
  }

  const dismiss = Navigation.useDismiss()

  return (
    <NavigationStack statusBarHidden persistentSystemOverlays="hidden">
      <List navigationTitle="备份与恢复" navigationBarTitleDisplayMode="inline"
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
        {/* Actions */}
        <Section header={<Text>操作</Text>}>

          <Button action={handleCreateBackup} disabled={loading || contacts.length === 0}>
            <HStack spacing={8}>
              <Image systemName="externaldrive.badge.plus" imageScale="medium" foregroundStyle="#007AFF" />
              <Text>立即备份 ({contacts.length} 个联系人)</Text>
            </HStack>
          </Button>
          <Button action={handleExportVCard} disabled={loading || contacts.length === 0}>
            <HStack spacing={8}>
              <Image systemName="square.and.arrow.up" imageScale="medium" foregroundStyle="#007AFF" />
              <Text>导出为 vCard</Text>
            </HStack>
          </Button>
        </Section>

        {/* Backup list */}
        <Section header={<Text>历史备份</Text>}>

          {backups.length === 0 ? (
            <ContentUnavailableView
              title="暂无备份"
              systemImage="externaldrive"
              description="点击上方按钮创建第一个备份"
            />
          ) : (
            backups.map((meta: BackupMeta) => (
              <HStack
                key={meta.id}
                spacing={8}
                padding={{ top: 6, bottom: 6, leading: 16, trailing: 16 }}
              >
                <Image systemName="externaldrive.fill" imageScale="medium" foregroundStyle="#34C759" />
                <VStack alignment="leading" spacing={2}>
                  <Text font="subheadline">{meta.count} 个联系人</Text>
                  <Text font="caption" foregroundStyle="secondaryLabel">{formatDate(meta.date)}</Text>
                </VStack>
                <Button title="恢复" action={() => handleRestore(meta)} buttonStyle="bordered" controlSize="small" />
                <Button action={() => handleDeleteBackup(meta)} buttonStyle="borderless">
                  <Image systemName="trash" imageScale="small" foregroundStyle="systemRed" />
                </Button>
              </HStack>
            ))
          )}
        </Section>

        {/* Info */}
        <Section>
          <Text font="caption" foregroundStyle="tertiaryLabel">
            备份文件存储在 App 的 Documents 目录中。建议定期备份以防数据丢失。备份不包含头像图片。
          </Text>
        </Section>
      </List>
    </NavigationStack>
  )
}

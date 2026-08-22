/**
 * SettingsPage - App configuration and preferences
 */

import { useState } from 'scripting'
import {
  Navigation, NavigationStack, List, Section, Text, VStack, HStack,
  Button, Image, Toggle, Picker
} from 'scripting'
import { AppSettings } from '../models/Contact'
import { loadSettings, saveSettings, resetSettings } from '../storage/Config'

interface SettingsPageProps {
  onBack: () => void
}

export function SettingsPage({ onBack }: SettingsPageProps) {
  const [settings, setSettings] = useState<AppSettings>(loadSettings)
  const [aboutExpanded, setAboutExpanded] = useState(false)

  const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    const updated = { ...settings, [key]: value }
    setSettings(updated)
    saveSettings(updated)
  }

  const handleReset = async () => {
    const confirmed = await Dialog.confirm({
      title: '重置设置',
      message: '将所有设置恢复为默认值？',
      confirmLabel: '重置',
      cancelLabel: '取消',
    })
    if (confirmed) {
      const defaults = resetSettings()
      setSettings(defaults)
    }
  }

  const dismiss = Navigation.useDismiss()

  return (
    <NavigationStack statusBarHidden persistentSystemOverlays="hidden">
      <List navigationTitle="设置" navigationBarTitleDisplayMode="inline"
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
        {/* General */}
        <Section header={<Text>通用</Text>}>

          <Toggle
            title="显示姓名首字母"
            value={settings.showInitials}
            onChanged={(v: boolean) => updateSetting('showInitials', v)}
          />
          <Picker
            title="默认排序"
            value={settings.defaultSort}
            onChanged={(v: string) => updateSetting('defaultSort', v as AppSettings['defaultSort'])}
            pickerStyle="inline"
          >
            <Text tag="familyName">按姓排序</Text>
            <Text tag="givenName">按名排序</Text>
            <Text tag="organizationName">按组织排序</Text>
          </Picker>
        </Section>

        {/* Backup */}
        <Section header={<Text>备份</Text>}>

          <Toggle
            title="自动备份"
            value={settings.autoBackup}
            onChanged={(v: boolean) => updateSetting('autoBackup', v)}
          />
          <Picker
            title="备份频率"
            value={settings.backupFrequency}
            onChanged={(v: string) => updateSetting('backupFrequency', v as AppSettings['backupFrequency'])}
            pickerStyle="inline"
          >
            <Text tag="daily">每天</Text>
            <Text tag="weekly">每周</Text>
            <Text tag="monthly">每月</Text>
          </Picker>
          {settings.autoBackup && (
            <Text font="caption" foregroundStyle="tertiaryLabel">
              自动备份在每次打开应用时检查并执行
            </Text>
          )}
        </Section>

        {/* About */}
        <Section header={<Text>关于</Text>}>

          <Button action={() => setAboutExpanded(!aboutExpanded)} buttonStyle="borderless">
            <HStack>
              <Image systemName="info.circle.fill" imageScale="medium" foregroundStyle="#007AFF" />
              <VStack alignment="leading" spacing={2}>
                <Text font="subheadline">联系人管理器</Text>
                <Text font="caption" foregroundStyle="secondaryLabel">版本 1.0.0</Text>
              </VStack>
              <Image systemName={aboutExpanded ? "chevron.up" : "chevron.down"} imageScale="small" foregroundStyle="tertiaryLabel" />
            </HStack>
          </Button>
          {aboutExpanded && (
            <VStack spacing={6} padding={{ leading: 16, trailing: 16, top: 4, bottom: 12 }}>
              <Text font="caption" foregroundStyle="secondaryLabel">
                一款简洁高效的开源联系人管理工具，支持批量操作、重复检测、备份恢复等功能。
              </Text>
              <HStack spacing={4}>
                <Text font="caption2" foregroundStyle="tertiaryLabel">作者: 7452323</Text>
                <Text font="caption2" foregroundStyle="tertiaryLabel">|</Text>
                <Text font="caption2" foregroundStyle="tertiaryLabel">License: MIT</Text>
              </HStack>
            </VStack>
          )}
        </Section>

        {/* Reset */}
        <Section>
          <Button title="重置所有设置" action={handleReset} role="destructive" buttonStyle="bordered" />
        </Section>
      </List>
    </NavigationStack>
  )
}

/**
 * 破壳日 · 原生设置页
 * 使用 Scripting 的 SwiftUI 风格原生组件，数据与 widget.tsx 共用。
 */
import {
  Button,
  DatePicker,
  HStack,
  Image,
  List,
  Navigation,
  NavigationStack,
  Script,
  Section,
  Spacer,
  Text,
  TextField,
  Toggle,
  VStack,
  useState,
} from 'scripting'
import { lunar2solar } from './lunar-calendar'

interface Settings {
  nickname: string
  birthday: string
  nongli: boolean
  eday: string
  bless: string
  avatarPath: string
}

const DEFAULTS: Settings = {
  nickname: '', birthday: '', nongli: false, eday: '', bless: '', avatarPath: '',
}
const accent = '#E84393'
const today = new Date()
const dayStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())

function loadSettings(): Settings {
  const saved = Storage.get<string>('birthday_settings')
  if (!saved) return { ...DEFAULTS }
  try { return { ...DEFAULTS, ...JSON.parse(saved) } } catch (_) { return { ...DEFAULTS } }
}

function saveSettings(settings: Settings) {
  Storage.set('birthday_settings', JSON.stringify(settings))
}

function parseDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function validBirthday(value: string, lunar: boolean): boolean {
  const date = parseDate(value)
  if (!lunar) return date !== null
  if (!date) return false
  try { lunar2solar(date.getFullYear(), date.getMonth() + 1, date.getDate()); return true } catch (_) { return false }
}

function dateValue(value: string): number {
  return (parseDate(value) || today).getTime()
}

function SettingsPage() {
  const dismiss = Navigation.useDismiss()
  const saved = loadSettings()
  const [nickname, setNickname] = useState(saved.nickname)
  const [birthday, setBirthday] = useState(saved.birthday)
  const [nongli, setNongli] = useState(saved.nongli)
  const [eday, setEday] = useState(saved.eday)
  const [bless, setBless] = useState(saved.bless)
  const [avatarPath, setAvatarPath] = useState(saved.avatarPath)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const current = (nextAvatar = avatarPath): Settings => ({
    nickname: nickname.trim(), birthday: birthday.trim(), nongli,
    eday: eday.trim(), bless: bless.trim(), avatarPath: nextAvatar,
  })

  const save = (): boolean => {
    const value = current()
    if (!value.birthday || !validBirthday(value.birthday, value.nongli)) {
      setError(value.nongli ? '请填写有效的农历日期（YYYY-MM-DD）' : '请填写有效的生日日期（YYYY-MM-DD）')
      setMessage('')
      return false
    }
    if (value.eday && !parseDate(value.eday)) {
      setError('相识日格式不正确，请使用 YYYY-MM-DD')
      setMessage('')
      return false
    }
    saveSettings(value)
    setError('')
    setMessage('已保存，小组件会自动更新')
    return true
  }

  const pickAvatar = async () => {
    try {
      const result = await Photos.pick({ limit: 1 })
      if (!result || result.length === 0) return
      const source = await result[0].imagePath()
      if (!source) return
      const folder = FileManager.appGroupDocumentsDirectory + '/birthday_avatar'
      if (!await FileManager.exists(folder)) await FileManager.createDirectory(folder, true)
      const destination = folder + '/avatar.jpg'
      if (await FileManager.exists(destination)) await FileManager.remove(destination)
      const image = UIImage.fromFile(source)
      const data = image ? image.toJPEGData(0.78) : null
      if (data) await FileManager.writeAsData(destination, data)
      else await FileManager.copyFile(source, destination)
      setAvatarPath(destination)
      saveSettings(current(destination))
      setMessage('头像已更新')
      setError('')
    } catch (_) {
      setError('头像处理失败，请重试')
      setMessage('')
    }
  }

  const clearAvatar = () => {
    setAvatarPath('')
    saveSettings(current(''))
    setMessage('已移除头像')
  }

  const finish = () => { if (save()) dismiss() }
  const changed = () => { setMessage(''); setError('') }

  return (
    <NavigationStack>
      <List
        navigationTitle="破壳日"
        navigationBarTitleDisplayMode="large"
        toolbar={{ cancellationAction: <Button title="完成" action={finish} /> }}
      >
        <Section>
          <VStack spacing={10} padding={6}>
            <HStack spacing={12}>
              <Image
                systemName="birthday.cake.fill"
                frame={{ width: 42, height: 42 }}
                foregroundStyle={accent as any}
              />
              <VStack alignment="leading" spacing={3}>
                <Text font={{ size: 22, weight: 'bold' } as any}>记录重要的日子</Text>
                <Text font={13} foregroundStyle={'rgba(128,128,128,0.72)' as any}>设置完成后，信息会显示在桌面小组件</Text>
              </VStack>
            </HStack>
          </VStack>
        </Section>

        <Section header={<Text>个人信息</Text>}>
          <HStack spacing={12}>
            {avatarPath ? (
              <Image filePath={avatarPath} frame={{ width: 52, height: 52 }} clipShape="circle" resizable />
            ) : (
              <Image systemName="person.crop.circle.fill" frame={{ width: 52, height: 52 }} foregroundStyle={'rgba(128,128,128,0.35)' as any} />
            )}
            <VStack alignment="leading" spacing={4}>
              <Text font={{ size: 17, weight: 'semibold' } as any}>{nickname || '你的昵称'}</Text>
              <HStack spacing={10}>
                <Button title="更换头像" action={pickAvatar} />
                {avatarPath ? <Button title="移除" action={clearAvatar} /> : null}
              </HStack>
            </VStack>
          </HStack>
          <TextField title="昵称" value={nickname} onChanged={(v) => { setNickname(v); changed() }} prompt="例如：小明" />
        </Section>

        <Section header={<Text>生日信息</Text>} footer={<Text>农历生日会自动换算为当年的公历日期。</Text>}>
          <DatePicker
            title="生日"
            displayedComponents={['date']}
            value={dateValue(birthday)}
            onChanged={(v) => { setBirthday(formatDate(v)); changed() }}
          />
          <HStack spacing={12}>
            <Image systemName="calendar.badge.checkmark" frame={{ width: 24, height: 24 }} foregroundStyle={accent as any} />
            <VStack alignment="leading" spacing={2}>
              <Text>农历生日</Text>
              <Text font={12} foregroundStyle={'rgba(128,128,128,0.72)' as any}>开启后按农历计算倒数</Text>
            </VStack>
            <Spacer />
            <Toggle title="农历生日" value={nongli} onChanged={(v) => { setNongli(v); changed() }} />
          </HStack>
        </Section>

        <Section header={<Text>纪念日</Text>} footer={<Text>用于计算你们相识了多少天，可留空。</Text>}>
          <DatePicker
            title="相识日"
            displayedComponents={['date']}
            value={dateValue(eday)}
            onChanged={(v) => { setEday(formatDate(v)); changed() }}
          />
        </Section>

        <Section header={<Text>小组件寄语</Text>} footer={<Text>最多显示两行，留一句想说的话吧。</Text>}>
          <TextField title="寄语" value={bless} onChanged={(v) => { setBless(v); changed() }} prompt="例如：愿你每天都开心" />
        </Section>

        <Section>
          <Button title="保存设置" action={save} />
          {error ? <Text font={13} foregroundStyle="red">{error}</Text> : null}
          {message ? <Text font={13} foregroundStyle="green">{message}</Text> : null}
        </Section>
      </List>
    </NavigationStack>
  )
}

async function run() {
  try { await Navigation.present(<SettingsPage />) } finally { Script.exit() }
}
run()

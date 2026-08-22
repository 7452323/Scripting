/**
 * 破壳日 - 生日纪念日小组件
 *
 * 左上角小圆环 + 右上角头像圆环 + 底部信息。
 * - Small/Medium:  圆环 + 头像 + 信息
 * - Large:         圆环 + 头像 + 信息 + 一言
 */

import {
  Circle,
  Color,
  Device,
  HStack,
  Image,
  Spacer,
  Text,
  VStack,
  Widget,
  ZStack,
  fetch,
} from 'scripting'
import {
  solar2lunar,
  getNextBirthday,
  getAge,
  getMeetDays,
  lunar2solar,
} from './lunar-calendar'

// ── 颜色 ──

const isDark = Device.colorScheme === 'dark'

const ringAccent: Color = isDark ? '#fc5ead' : '#e84393'
const ringBg: Color = isDark
  ? 'rgba(255,255,255,0.15)'
  : 'rgba(0,0,0,0.08)'
const textPrimary: Color = isDark ? 'white' : '#1a1a1a'
const textSecondary: Color = isDark
  ? 'rgba(255,255,255,0.6)'
  : 'rgba(0,0,0,0.5)'

// ── 设置 ──

interface Settings {
  nickname: string
  birthday: string
  nongli: boolean
  eday: string
  bless: string
  avatarPath: string
}

interface Data {
  nickname: string
  configured: boolean
  meetDays: number
  progressPercent: number
  daysUntilBirthday: number
  ageText: string
  lunarText: string
  nextBirthdayText: string
  bless: string
  avatarPath: string
}

const DEFAULTS: Settings = {
  nickname: '',
  birthday: '',
  nongli: false,
  eday: '',
  bless: '',
  avatarPath: '',
}

function loadSettings(): Settings {
  const saved = Storage.get<string>('birthday_settings')
  if (saved) {
    try {
      return { ...DEFAULTS, ...JSON.parse(saved) }
    } catch (_) {}
  }
  return { ...DEFAULTS }
}

function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  )
}

function isValidBirthday(value: string, isLunar: boolean): boolean {
  if (!isLunar) return isValidDateString(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  try {
    lunar2solar(year, month, day)
    return true
  } catch (_) {
    return false
  }
}

function emptyData(s: Settings): Data {
  return {
    nickname: s.nickname || '破壳日',
    configured: false,
    meetDays: 0,
    progressPercent: 0,
    daysUntilBirthday: 0,
    ageText: '--',
    lunarText: '--',
    nextBirthdayText: '--',
    bless: s.bless,
    avatarPath: s.avatarPath,
  }
}

function computeData(s: Settings): Data {
  const now = new Date()
  const birthday = s.birthday.trim()
  if (!isValidBirthday(birthday, s.nongli)) {
    return emptyData(s)
  }

  const [by, bm, bd] = birthday.split('-').map(Number)
  let ageBirthday = birthday
  if (s.nongli) {
    try {
      const solarBirth = lunar2solar(by, bm, bd)
      ageBirthday = `${solarBirth.cYear}-${String(solarBirth.cMonth).padStart(2, '0')}-${String(solarBirth.cDay).padStart(2, '0')}`
    } catch (_) {
      return emptyData(s)
    }
  }
  const age = getAge(ageBirthday) as { year: number; month: number; day: number }
  const ageText =
    age.year > 0
      ? `${age.year}岁${age.month > 0 ? age.month + '月' : ''}`
      : age.month > 0
        ? `${age.month}月${age.day}天`
        : `${age.day}天`

  // 农历显示生日设置对应的农历，而不是今天的农历。
  let lunarText = '--'
  try {
    let solarYear = by
    let solarMonth = bm
    let solarDay = bd
    if (s.nongli) {
      const solarBirthday = lunar2solar(by, bm, bd)
      solarYear = solarBirthday.cYear
      solarMonth = solarBirthday.cMonth
      solarDay = solarBirthday.cDay
    }
    const birthdayLunar = solar2lunar(solarYear, solarMonth, solarDay)
    lunarText = `${birthdayLunar.IMonthCn}${birthdayLunar.IDayCn}`
  } catch (_) {}

  const nextBirthday = getNextBirthday(by, bm, bd, s.nongli, false)
  const nextBirthdayText = nextBirthday
    ? `${nextBirthday.cYear}-${String(nextBirthday.cMonth).padStart(2, '0')}-${String(nextBirthday.cDay).padStart(2, '0')}`
    : '--'

  let progressPercent = 0
  let daysUntilBirthday = 0
  if (nextBirthday) {
    const nextDate = new Date(nextBirthday.cYear, nextBirthday.cMonth - 1, nextBirthday.cDay)
    const diffMs = nextDate.getTime() - now.getTime()
    daysUntilBirthday = Math.ceil(diffMs / 86400000)
    const lastBirthday = new Date(nextBirthday.cYear - 1, nextBirthday.cMonth - 1, nextBirthday.cDay)
    const yearMs = nextDate.getTime() - lastBirthday.getTime()
    const elapsedMs = now.getTime() - lastBirthday.getTime()
    progressPercent = Math.min(1, Math.max(0, elapsedMs / yearMs))
  }

  let meetDays = 0
  if (s.eday) {
    meetDays = getMeetDays(s.eday)
  }

  return {
    nickname: s.nickname || '破壳日',
    configured: true,
    meetDays,
    progressPercent,
    daysUntilBirthday,
    ageText,
    lunarText,
    nextBirthdayText,
    bless: s.bless,
    avatarPath: s.avatarPath,
  }
}

// ── 组件 ──

// 圆环与头像共用同一个外径，确保两者视觉尺寸完全对齐。
const ringDiameter = 42

/** 倒计时小圆环 — 靠左 */
function RingView({
  size = ringDiameter,
  progress,
  daysUntil,
  configured,
}: {
  size?: number
  progress: number
  daysUntil: number
  configured: boolean
}) {
  // 双层圆环：外圈与内圈保留呼吸感，中间色带按进度逐步填满。
  const outerSize = size
  const innerSize = size - 9
  const middleSize = size - 4
  const trackStroke = Math.max(1.8, size * 0.045)
  const progressStroke = Math.max(3, size * 0.075)

  return (
    <ZStack>
      <Circle stroke={{ shapeStyle: ringBg, strokeStyle: { lineWidth: trackStroke } }} frame={{ width: outerSize, height: outerSize }} />
      <Circle stroke={{ shapeStyle: ringBg, strokeStyle: { lineWidth: trackStroke } }} frame={{ width: innerSize, height: innerSize }} />
      <Circle
        trim={{ from: 0, to: progress }}
        stroke={{ shapeStyle: ringAccent, strokeStyle: { lineWidth: progressStroke, lineCap: 'round' } }}
        frame={{ width: middleSize, height: middleSize }}
        widgetAccentable
      />
      <Text font={Math.round(size * 0.4)} foregroundStyle={ringAccent} multilineTextAlignment="center" widgetAccentable>
        {!configured ? '--' : daysUntil > 0 ? `${daysUntil}` : '🎉'}
      </Text>
    </ZStack>
  )
}

/** 头像圆环 — 靠右 */
function AvatarCircle({ path }: { path: string }) {
  const size = ringDiameter
  const bg: Color = isDark
    ? 'rgba(255,255,255,0.08)'
    : 'rgba(0,0,0,0.05)'

  if (path) {
    return (
      <Image
        filePath={path}
        frame={{ width: size, height: size }}
        clipShape="circle"
        resizable
        widgetAccentedRenderingMode="fullColor"
      />
    )
  }

  return (
    <VStack
      frame={{ width: size, height: size }}
      alignment="center"
      background={bg}
      clipShape="circle"
    >
      <Text
        font={18}
        foregroundStyle={'rgba(128,128,128,0.35)' as any}
        multilineTextAlignment="center"
      >
        🎂
      </Text>
    </VStack>
  )
}

// ── 组件 ──
function InfoPanel({ data }: { data: Data }) {
  return (
    <VStack spacing={2}>
      {/* 三列布局：图标 | 标签 | 值 */}
      <HStack spacing={4}>
        <VStack spacing={2} frame={{ width: 20, alignment: 'center' }}>
          <Text font={11} foregroundStyle={textSecondary}>⏳</Text>
          <Text font={11} foregroundStyle={textSecondary}>📅</Text>
          <Text font={11} foregroundStyle={textSecondary}>🎁</Text>
        </VStack>
        <VStack spacing={2} frame={{ width: 28, alignment: 'leading' }}>
          <Text font={11} foregroundStyle={textSecondary}>年龄</Text>
          <Text font={11} foregroundStyle={textSecondary}>农历</Text>
          <Text font={11} foregroundStyle={textSecondary}>生日</Text>
        </VStack>
        <VStack spacing={2} alignment="trailing">
          <Text font={11} foregroundStyle={textPrimary} lineLimit={1}>{data.ageText}</Text>
          <Text font={11} foregroundStyle={textPrimary} lineLimit={1}>{data.lunarText}</Text>
          <Text font={11} foregroundStyle={textPrimary} lineLimit={1}>{data.nextBirthdayText}</Text>
        </VStack>
      </HStack>

      <Text
        font={10}
        foregroundStyle={textSecondary}
        multilineTextAlignment="leading"
        lineLimit={2}
      >
        {data.configured ? (data.bless || quoteText) : '打开脚本设置生日'}
      </Text>
    </VStack>
  )
}

// ── 一言 ──

async function fetchQuote(): Promise<string> {
  try {
    const res = await fetch('https://v1.hitokoto.cn/', { timeout: 8 })
    if (res.ok) {
      const data: any = await res.json()
      if (data && data.hitokoto) return data.hitokoto
    }
  } catch (_) {}
  try {
    const res = await fetch('https://api.btstu.cn/yan/api.php?charset=utf-8&encode=json', { timeout: 8 })
    if (res.ok) {
      const data: any = await res.json()
      if (data && data.text) return data.text
    }
  } catch (_) {}
  return '愿你每一天都充满阳光 ☀️'
}

// ── 主组件 ──

let quoteText = ''

function WidgetView() {
  const settings = loadSettings()
  const data = computeData(settings)

  return (
    <ZStack>
      <VStack padding={12} spacing={6}>
        {/* 昵称 + 相识天数 — 最上边 */}
        <HStack alignment="center" spacing={6}>
          <Text font={15} foregroundStyle={textPrimary} widgetAccentable>
            {data.nickname}
          </Text>
          {data.meetDays > 0 && (
            <Text font={20} foregroundStyle={ringAccent} widgetAccentable>
              {data.meetDays}
            </Text>
          )}
        </HStack>

        {/* 中间行：圆环靠左 + 头像靠右 */}
        <HStack alignment="center" spacing={18}>
          <RingView
            size={42}
            progress={data.progressPercent}
            daysUntil={data.daysUntilBirthday}
            configured={data.configured}
          />
          <AvatarCircle path={data.avatarPath} />
        </HStack>

        {/* 信息面板 */}
        <InfoPanel data={data} />
      </VStack>
    </ZStack>
  )
}

// ── 入口 ──

async function main() {
  const settings = loadSettings()
  quoteText = isValidBirthday(settings.birthday.trim(), settings.nongli) ? await fetchQuote() : ''
  const now = new Date()
  const nextMidnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0, 0, 0,
  )
  Widget.present(<WidgetView />, {
    reloadPolicy: { policy: 'after', date: nextMidnight },
  })
}

main()

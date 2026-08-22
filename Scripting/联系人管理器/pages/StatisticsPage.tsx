/**
 * StatisticsPage - Clean, cohesive statistics display
 */

import {
  Navigation, NavigationStack, List, Section, Text, VStack, HStack,
  Image, Button
} from 'scripting'
import { ContactInfo } from '../models/Contact'
import { getContactStats } from '../services/ContactService'
import { StatisticCard } from '../components/StatisticCard'

interface StatisticsPageProps {
  contacts: ContactInfo[]
  onBack: () => void
}

export function StatisticsPage({ contacts, onBack }: StatisticsPageProps) {
  const stats = getContactStats(contacts)
  const dismiss = Navigation.useDismiss()

  const completionRate = stats.total > 0
    ? Math.round((1 - stats.emptyNames / stats.total) * 100)
    : 100

  return (
    <NavigationStack statusBarHidden persistentSystemOverlays="hidden">
      <List navigationTitle="统计信息" navigationBarTitleDisplayMode="inline"
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
        {/* Stat cards grid */}
        <Section padding={{ top: 12, bottom: 8 }}>
          <HStack spacing={10}>
            <StatisticCard icon="person.2.fill" label="总联系人" value={stats.total} color="#007AFF" />
            <StatisticCard icon="phone.fill" label="有电话" value={stats.withPhone} color="#34C759" />
          </HStack>
          <HStack spacing={10} padding={{ top: 10 }}>
            <StatisticCard icon="envelope.fill" label="有邮箱" value={stats.withEmail} color="#FF9500" />
            <StatisticCard icon="mappin.circle.fill" label="有地址" value={stats.withAddress} color="#5856D6" />
          </HStack>
          <HStack spacing={10} padding={{ top: 10 }}>
            <StatisticCard icon="building.2.fill" label="有组织" value={stats.withOrganization} color="#8E8E93" />
            <StatisticCard icon="exclamationmark.triangle.fill" label="无姓名" value={stats.emptyNames} color="#FF2D55" />
          </HStack>
        </Section>

        {/* Progress bars */}
        <Section header={<Text>数据完整度</Text>}>
          <StatRow label="电话" value={stats.withPhone} total={stats.total} color="#34C759" />
          <StatRow label="邮箱" value={stats.withEmail} total={stats.total} color="#FF9500" />
          <StatRow label="地址" value={stats.withAddress} total={stats.total} color="#5856D6" />
          <StatRow label="组织" value={stats.withOrganization} total={stats.total} color="#8E8E93" />
        </Section>

        {/* Summary */}
        <Section>
          <VStack spacing={8} padding={{ top: 8, bottom: 12 }}>
            <Text font="subheadline" foregroundStyle="label">
              数据完整度 {completionRate}%
            </Text>
            <Text font="caption2" foregroundStyle="tertiaryLabel">
              基于 {stats.total} 个联系人 · 建议定期检查重复和缺失信息
            </Text>
          </VStack>
        </Section>
      </List>
    </NavigationStack>
  )
}

/** Progress bar row */
function StatRow({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const percent = total > 0 ? Math.round((value / total) * 100) : 0

  return (
    <VStack spacing={6} padding={{ top: 8, bottom: 8 }}>
      <HStack>
        <Text font="subheadline" foregroundStyle="label">{label}</Text>
        <Text font="subheadline" foregroundStyle="secondaryLabel">{value}/{total} ({percent}%)</Text>
      </HStack>
      <HStack background="systemGray5">
        <HStack background={color as any} />
      </HStack>
    </VStack>
  )
}

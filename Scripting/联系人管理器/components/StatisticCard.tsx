/**
 * StatisticCard - Minimal style, no jarring background
 */

import { VStack, Text, Image } from 'scripting'

interface StatisticCardProps {
  icon: string
  label: string
  value: string | number
  color?: string
}

export function StatisticCard({ icon, label, value, color = "#007AFF" }: StatisticCardProps) {
  return (
    <VStack
      spacing={4}
      padding={{ top: 12, bottom: 12, leading: 12, trailing: 12 }}
      alignment="center"
    >
      <Image systemName={icon} imageScale="small" foregroundStyle={color as any} />
      <Text font="title3" fontWeight="semibold" foregroundStyle="label">{String(value)}</Text>
      <Text font="caption2" foregroundStyle="secondaryLabel">{label}</Text>
    </VStack>
  )
}

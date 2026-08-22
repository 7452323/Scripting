/**
 * BottomToolbar - Floating pill-shaped action bar
 */

import { HStack, Button, Image, Text } from 'scripting'

export interface ToolbarAction {
  title: string
  systemImage: string
  destructive?: boolean
  action: () => void
}

interface BottomToolbarProps {
  actions: ToolbarAction[]
  visible: boolean
}

export function BottomToolbar({ actions, visible }: BottomToolbarProps) {
  if (!visible) return <></>

  return (
    <HStack
      spacing={0}
      padding={{ top: 16, bottom: 16, leading: 16, trailing: 16 }}
      background="systemBackground"
    >
      {actions.map((act, index) => (
        <Button
          key={index}
          action={act.action}
          buttonStyle="plain"
        >
          <HStack spacing={6} padding={{ leading: 16, trailing: 16, top: 10, bottom: 10 }}>
            <Image
              systemName={act.systemImage}
              imageScale="small"
              foregroundStyle={act.destructive ? "#FF3B30" : "#8E8E93"}
            />
            <Text
              font="subheadline"
              fontWeight="medium"
              foregroundStyle={act.destructive ? "#FF3B30" : "#8E8E93"}
            >
              {act.title}
            </Text>
          </HStack>
        </Button>
      ))}
    </HStack>
  )
}

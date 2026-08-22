import {
  HStack,
  VStack,
  Text,
  Image,
  Spacer,
  LiveActivity,
  LiveActivityUI,
  LiveActivityUIBuilder,
  LiveActivityUIExpandedCenter,
} from "scripting"

export const TICKET_LIVE_ACTIVITY_NAME = "PulseNetTicketClock"

export interface TicketClockState {
  time: string
}

const builder: LiveActivityUIBuilder<TicketClockState> = state => (
  <LiveActivityUI
    content={
      <HStack
        spacing={12}
        padding={16}
        activityBackgroundTint={{ light: "black", dark: "black" }}
      >
        <Image systemName="clock.fill" foregroundStyle="systemBlue" font={24} />
        <VStack alignment="leading" spacing={2}>
          <Text font={12} foregroundStyle="systemGray2">抢票时间</Text>
          <Text font={30} fontWeight="bold" foregroundStyle="white" monospacedDigit>
            {state.time}
          </Text>
        </VStack>
        <Spacer />
      </HStack>
    }
    compactLeading={
      <Image systemName="clock.fill" foregroundStyle="systemBlue" font={11} />
    }
    compactTrailing={
      <Text font={10} fontWeight="semibold" foregroundStyle="white" monospacedDigit>
        {state.time}
      </Text>
    }
    minimal={
      <Image systemName="clock.fill" foregroundStyle="systemBlue" />
    }
  >
    <LiveActivityUIExpandedCenter>
      <HStack spacing={10}>
        <Image systemName="clock.fill" foregroundStyle="systemBlue" />
        <Text font={13} foregroundStyle="systemGray2">抢票时间</Text>
        <Text font={24} fontWeight="bold" foregroundStyle="white" monospacedDigit>
          {state.time}
        </Text>
      </HStack>
    </LiveActivityUIExpandedCenter>
  </LiveActivityUI>
)

export const TicketClockLiveActivity = LiveActivity.register<TicketClockState>(
  TICKET_LIVE_ACTIVITY_NAME,
  builder
)

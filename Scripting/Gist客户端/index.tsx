import {
  Navigation, NavigationStack, Script, ScrollView, Divider, Spacer,
  useState, HStack, VStack, Text, Button, List, Section,
  Image,
} from "scripting"

import {
  HomeTab, SettingsTab,
} from "./shared"

// ─── 主入口 ────────────────────────────────────────────────────
function App() {
  const dismiss = Navigation.useDismiss()
  const tabs = [
    { name: "Gist", icon: "doc.text" },
    { name: "设置", icon: "gear" },
  ] as const
  const [selectedTab, setSelectedTab] = useState<string>("Gist")
  const accentColor = "systemBlue"

  return (
    <NavigationStack>
      <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
        <ScrollView axes="horizontal" scrollIndicator="hidden">
          <HStack padding={{ leading: 12, trailing: 12, top: 6, bottom: 6 }}
                  spacing={6}>
            {tabs.map(function(tab) {
              const active = selectedTab === tab.name
              return (
                <Button
                  key={tab.name}
                  title={tab.name}
                  systemImage={tab.icon}
                  action={function() { setSelectedTab(tab.name) }}
                  background={active ? accentColor : "clear"}
                  foregroundStyle={active ? "white" : "label"}
                  frame={{ maxWidth: "infinity" }}
                  padding={{ leading: 14, trailing: 14, top: 8, bottom: 8 }}
                  clipShape={{ type: "rect", cornerRadius: 8 }}
                />
              )
            })}
          </HStack>
        </ScrollView>
        <Divider />
        {selectedTab === "Gist" ? <HomeTab onClose={dismiss} /> : null}
        {selectedTab === "设置" ? <SettingsTab /> : null}
      </VStack>
    </NavigationStack>
  )
}

async function run() {
  await Navigation.present({
    element: <App />,
    modalPresentationStyle: "fullScreen",
  })
}

void run().finally(Script.exit)

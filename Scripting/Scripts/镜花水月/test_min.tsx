import {
  Navigation,
  NavigationStack,
  Script,
  TabView,
  Tab,
  useObservable,
  VStack,
  Text,
  Button,
  List,
} from "scripting"

function View1() {
  return (
    <List
      navigationTitle="页面一"
      navigationBarTitleDisplayMode="large"
    >
      <Text>内容一</Text>
    </List>
  )
}

function View2() {
  return (
    <List navigationTitle="页面二" navigationBarTitleDisplayMode="large">
      <Text>内容二</Text>
    </List>
  )
}

function View3() {
  return (
    <List navigationTitle="页面三" navigationBarTitleDisplayMode="large">
      <Text>内容三</Text>
    </List>
  )
}

function App() {
  const tabSelection = useObservable<number>(0)
  return (
    <TabView tint="systemPink" selection={tabSelection}>
      <Tab title="主页" systemImage="house.fill" value={0}><NavigationStack><View1 /></NavigationStack></Tab>
      <Tab title="历史" systemImage="clock.fill" value={1}><NavigationStack><View2 /></NavigationStack></Tab>
      <Tab title="设置" systemImage="gearshape.fill" value={2}><NavigationStack><View3 /></NavigationStack></Tab>
    </TabView>
  )
}

async function main() {
  await Navigation.present(<App />)
  Script.exit()
}

main().catch((err) => { console.error(err); Script.exit() })

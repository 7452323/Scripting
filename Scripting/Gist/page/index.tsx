import {
  Button,
  Navigation,
  NavigationSplitView,
  Script,
  Toolbar,
  ToolbarItem,
  ToolbarSpacer,
} from "scripting";
import { View as ListView } from "./list";
import { View as SettingView } from "./setting";

export function View() {
  const dismiss = Navigation.useDismiss();
  return (
    <NavigationSplitView
      sidebar={
        <ListView
          navigationTitle=""
        navigationBarTitleDisplayMode="inline"
          // toolbar={{
          //   topBarLeading: [<Button title={"退出"} systemImage={"xmark"} action={dismiss} />],
          //   topBarTrailing: [
          //     <Button
          //       title="设置"
          //       systemImage={"gear"}
          //       action={() => {
          //         Navigation.present(<SettingView />);
          //       }}
          //     />,
          //   ],
          // }}
          toolbar={
            <Toolbar>
              <ToolbarSpacer placement={"topBarLeading"} />
              <ToolbarItem placement={"topBarLeading"}>
                <Button title={"退出"} systemImage={"xmark"} action={dismiss} />
              </ToolbarItem>
            </Toolbar>
          }
        />
      }>
      <></>
    </NavigationSplitView>
  );
}

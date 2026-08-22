// home_screen_default_ui.tsx
// 作为 App 首页的一个 Tab 渲染（设置 → Show Home Tab 打开开关，并选择本脚本）。
// 与 index.tsx 不同：组件被直接挂到 Tab 上——
//  - 主视图直接 return，不要用 Navigation.present 呈现
//  - 不要调用 Script.exit()，退出会杀掉常驻实例
//  - 顶层代码只在 Tab 首次构建 UI 时执行一次
// 运行时 Script.env === "home_screen"，可据此与 index.tsx 复用组件走不同分支。
import { NavigationSplitView } from "scripting";
import { View as ListView } from "./page/list";

export default function HomeScreenView() {
  return (
    <NavigationSplitView
      sidebar={<ListView navigationTitle="Gist" />}
    >
      <></>
    </NavigationSplitView>
  );
}

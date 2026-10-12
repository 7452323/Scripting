/**
 * 镜花水月 —— 独立运行入口（从脚本列表运行 / 分享面板导入时走这里）。
 *
 * 真正的内容全部在 shared.tsx（无副作用，可被首页 Tab 复用）；这个文件只做一件事：
 * 以全屏弹窗跑一遍完整 App（三个 Tab：作品 / 历史 / 设置），关闭后退出实例。
 *
 * ⚠️ 不要在 home_screen_default_ui.tsx 里 `import ... from "./index"`：
 *    本文件顶层有 Navigation.present + Script.exit 副作用，import 会执行它们
 *    （首页会变成「无法渲染此视图」或实例被退出）。
 */
import { Navigation, Script } from "scripting"
import { App } from "./shared"

async function run() {
  try {
    await Navigation.present({
      element: <App />,
      modalPresentationStyle: 'overFullScreen',
    })
  } finally {
    Script.exit()
  }
}

run()

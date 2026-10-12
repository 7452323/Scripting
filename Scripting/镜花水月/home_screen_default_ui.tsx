/**
 * 镜花水月 —— App 首页 Home Tab 入口。
 *
 * 首页直接就是「作品页」（不套菜单）；历史 / 设置 在作品页顶栏上
 * （通过 `homeTab` prop 告诉 HomeView，只在首页 Tab 里显示那两个入口）。
 *
 * ⚠️ 这是「常驻组件入口」，不是脚本运行入口，所以：
 *   · 不调用 Script.exit
 *   · 不嵌套第二套 TabView（本脚本属于「完整 App 是 TabView」那一类，首页不嵌 Tab 栏）
 *   · 这里也**不再包 NavigationStack** —— HomeView 自己已经带了一个，再包就成嵌套
 *
 * 状态常驻：切到别的 Tab 再切回来不会重建；改完代码要在 tab bar 上长按
 * Home 图标 → Reload 才会生效。
 */
import { HomeView } from "./shared"

export default function HomeScreenView() {
  // homeTab：让作品页顶栏改成「历史 / 设置」入口（独立运行的 App 版本不传，那里是 Tab）
  return <HomeView isActive={true} homeTab={true} />
}

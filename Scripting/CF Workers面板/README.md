# CF Workers面板

Cloudflare Workers 与 Pages 调用监控脚本，提供主屏幕小组件和应用内配置页。

## 首次使用

1. 在 Scripting App 运行“CF Workers面板”。
2. 在配置页选择认证方式，填写 Cloudflare API Token 或 Global API Key，并选择账户。
3. 保存配置后，脚本将配置安全写入 App Group，供小组件读取。
4. 在主屏幕添加“CF Workers面板”小组件，选择小、中或大尺寸。

## 所需权限与配置

- 推荐使用 Cloudflare API Token，并授予读取 Workers、Workers Analytics 和 Pages Functions Analytics 所需权限。
- 也支持 Global API Key，需要同时填写 Cloudflare 账户邮箱。
- 配置保存在 App Group 文件中，仅供本脚本的小组件读取。
- 不要将 API Token 或 Global API Key 写入公开脚本、截图或日志。

## 小组件数据

- Workers 脚本列表来自 Cloudflare Workers API。
- 调用量、错误量、近 7 天趋势、今日 Workers 调用和 Pages Functions 调用来自 Cloudflare GraphQL Analytics。
- Cloudflare 未返回分析数据时，脚本仍显示可读取的 Workers 列表，统计值为零。
- 保存配置或在面板中手动刷新后，会调用 `Widget.reloadUserWidgets()` 请求系统刷新桌面组件。
- 实际刷新时间仍由 WidgetKit 根据系统资源调度。

## 背景模式

- 普通模式保留 CF Workers面板的渐变或配额卡片背景。
- 透明、模糊和模拟透明模式下，背景使用 `widgetBackground` 自动交由系统壁纸或模糊层绘制。

## 更新日志

### 1.2.0 - 2026-08-29

- 项目目录与脚本注册名称统一更新为“CF Workers面板”。
- 保持 App Group 配置路径不变，已有 Cloudflare 配置和小组件数据可继续使用。

### 1.1.0 - 2026-08-29

- 脚本对外名称更新为“CF Workers面板”。

### 1.0.0 - 2026-08-29

- 初始版本。
- 提供 Cloudflare Workers 与 Pages 调用监控。
- 支持小、中、大和锁屏小组件布局。
- 支持透明、模糊和模拟透明背景模式。

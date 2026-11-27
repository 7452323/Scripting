# MediaHub

## 用途
全能媒体播放器。支持本地/直链、Emby、Plex、115 网盘、JS/JSON/Python 脚本源，以及 TMDB 标题刮削。

## 功能（v0.2.1）
- 底部 Tab：首页 / 媒体库 / 搜索 / 设置
- 左上角关闭、右上角最小化
- 上滑收起底部 Tab
- 原生 AVPlayer（PiP / 鉴权请求头 / 进度记忆）
- Emby / Plex / 115 / 脚本源
- TMDB 可选刮削
- 示例脚本源：`samples/demo-source.js`

## 使用
1. 更新脚本后运行。
2. 设置中配置源并登录/检测。
3. 媒体库「刷新远程源」或搜索。
4. 115 Cookie 可从「115获取Cookie」项目获取。

## 脚本源
支持：
- 远程 JS（`main(query)` / `getList(query)`）
- 纯 JSON `{ "list": [...] }`
- Python（环境支持时）

示例 raw：
```
https://raw.githubusercontent.com/7452323/Scripting/main/Scripting/MediaHub/samples/demo-source.js
```

## 版本
### 0.2.2
- 修复：各页面空白（Section 头部/尾部传了字符串，整页构建失败）
- 修复：页面标题不显示（TabView 内每页独立 NavigationStack）
- 修复：Dialog / DocumentPicker / SharedAudioSession 误从 scripting 导入导致运行时未定义
- 修复：各源文件未导入 fetch，请求时会抛错
- 优化：关闭与最小化按钮下沉到页面工具栏，全面屏呈现 + 下滑最小化
### 0.2.1
- 代码质量：统一 RemoteMedia、播放鉴权头、Emby/Plex 可播过滤
- 115 播放带 Cookie；设置敏感项 SecureField
- 播放器关闭按钮；示例脚本源
### 0.2.0
- 多源接入 + 关闭/最小化工具栏

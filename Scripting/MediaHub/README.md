# MediaHub

## 用途
全能媒体播放器。支持本地/直链、Emby、Plex、115 网盘、JS/Python 脚本源，以及 TMDB 标题刮削。

## 功能（v0.2.0）
- 底部 Tab：首页 / 媒体库 / 搜索 / 设置
- 左上角关闭、右上角最小化（与 MoonTV 相同写法）
- 上滑收起底部 Tab
- 原生 AVPlayer 播放（PiP / Now Playing）
- Emby：登录、最近列表、搜索、直链播放
- Plex：Token 连接、最近添加、搜索、直链播放
- 115：Cookie 校验、视频列表、取直链播放
- 脚本源：远程/本地 JS（及 Python 若环境支持）
- TMDB API Key 可选刮削

## 使用
1. 更新/导入脚本后运行。
2. 在「设置」配置 Emby / Plex / 115 Cookie / 脚本源 / TMDB Key。
3. 在「媒体库」刷新远程源或添加本地/URL。
4. 115 Cookie 可从本仓库「115获取Cookie」项目获取。

## 脚本源格式
JS 示例：实现 `main(query)` 或 `getList(query)`，返回：
```json
{ "list": [{ "title": "片名", "url": "https://...", "poster": "https://..." }] }
```

## 版本
### 0.2.0
- 恢复关闭/最小化工具栏（NavigationStack + TabView Toolbar）
- 接入 Emby / Plex / 115 / 脚本源 / TMDB
### 0.1.x
- 基础播放与媒体库

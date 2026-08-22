# Scripting 脚本库

这里是本仓库的主要脚本目录。每个子目录都是一个相对独立的 Scripting App 项目。

| 操作 | 入口 |
| --- | --- |
| 安装 Scripting App | [打开 App Store](https://apps.apple.com/app/apple-store/id6479691128) |
| 导入这个目录内的全部脚本 | [一键导入](https://scripting.fun/import_scripts?urls=%5B%22https%3A%2F%2Fgithub.com%2F7452323%2FScripting-Script-Library%2Ftree%2Fmain%2FScripting%2FScripts%22%5D) |

请在 iPhone 或 iPad 上点击“一键导入”。若设备尚未安装 Scripting，请先通过上方 App Store 链接安装。

## 导入单个项目

1. 打开需要的脚本目录。
2. 阅读其中的 `README.md`，确认配置和权限要求。
3. 点击脚本 README 中的“**一键导入**”链接。

请保留脚本目录中的全部文件。除了 `script.json` 和 `index.tsx`，项目可能还依赖组件、页面、服务、存储、Widget、Intent、SVG、GeoJSON 或其他资源。

## 项目结构

```text
Scripting/Scripts/
├── 脚本 A/
│   ├── script.json
│   ├── index.tsx
│   └── README.md
├── 脚本 B/
│   └── ...
└── README.md
```

## 新脚本归档位置

以后新增的 Scripting 脚本统一放在：

```text
Scripting/Scripts/脚本名称/
```

新增项目的 README 必须提供一键导入链接，写法如下，其中 `脚本名称` 需替换为实际目录名：

```md
[一键导入](https://scripting.fun/import_scripts?urls=%5B%22https%3A%2F%2Fgithub.com%2F7452323%2FScripting-Script-Library%2Ftree%2Fmain%2FScripting%2FScripts%2F脚本名称%22%5D)
```

修改已有脚本时，请尽量保留原目录结构，并同步更新脚本自己的 README。敏感信息、Token、Cookie、账号密码和个人本地路径不要提交。

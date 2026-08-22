# Scripting Script Library

> 个人 Scripting App 脚本库，集中保存、整理和分享可直接导入 Scripting 的脚本项目。

[![Scripting](https://img.shields.io/badge/Scripting-iOS%20%7C%20iPadOS-007AFF?logo=apple&logoColor=white)](https://apps.apple.com/app/apple-store/id6479691128)
[![Scripts](https://img.shields.io/badge/scripts-166-34C759)](Scripting/Scripts/)
[![License](https://img.shields.io/badge/license-personal-lightgrey)](#)

## 开始使用

| 操作 | 入口 |
| --- | --- |
| 尚未安装 Scripting | [安装 Scripting App](https://apps.apple.com/app/apple-store/id6479691128) |
| 一次导入全部脚本 | [一键导入脚本库](https://scripting.fun/import_scripts?urls=%5B%22https%3A%2F%2Fgithub.com%2F7452323%2FScripting-Script-Library%2Ftree%2Fmain%2FScripting%2FScripts%22%5D) |
| 浏览并选择脚本 | [打开脚本目录](Scripting/Scripts/) |

在 iPhone 或 iPad 上点击“**一键导入脚本库**”，Scripting 会打开导入页面并读取本仓库的 `Scripting/Scripts` 目录。首次使用请先点击“**安装 Scripting App**”。

## 这里有什么

本仓库主要存放我自己编写、整理或长期维护的 Scripting 脚本。脚本会尽量保留完整项目结构，不只保存入口文件，因此组件、页面、服务、存储、Widget、Intent 和图片等资源也会一起归档。

脚本来源于旧仓库 [`QuantumultX/Scripting/Scripts`](https://github.com/7452323/QuantumultX/tree/main/Scripting/Scripts)，后续新写的 Scripting 脚本也统一放在这里。

## 导入单个脚本

1. 在 [`Scripting/Scripts`](Scripting/Scripts/) 中打开需要的脚本目录。
2. 阅读脚本目录中的 `README.md`，确认用途、权限和配置要求。
3. 点击该 README 提供的“**一键导入**”链接；没有链接时，可从目录页使用 Scripting 的导入入口。

不要只下载 `index.tsx`。很多项目依赖同目录下的 `script.json`、其他 `.ts/.tsx` 文件和资源文件。

## 仓库结构

```text
Scripting-Script-Library/
├── Scripting/
│   └── Scripts/       # 主要脚本库，每个子目录是一个独立项目
├── examples/          # 最小示例和通用模板
├── README.md          # 仓库总说明
└── CONTRIBUTING.md    # 新脚本收录规范
```

## 一个脚本项目通常长这样

```text
我的脚本/
├── script.json        # Scripting 项目配置
├── index.tsx          # 普通运行入口
├── README.md          # 用途、配置和一键导入链接
└── components/        # 可选：组件、页面、服务和资源
```

不同项目可以包含 `widget.tsx`、`intent.tsx`、`app_intents.tsx`、Live Activity 文件或其他辅助目录，以项目实际需要为准。

## 新脚本会放在哪里

以后新增或修改的 Scripting 脚本默认放在：

```text
Scripting/Scripts/脚本名称/
```

每个脚本使用独立目录，目录名使用清晰、稳定的脚本名称。新增脚本时尽量同时提供项目说明和一键导入链接；有配置项、权限请求或外部服务依赖的项目，必须在说明中写清楚。

## 注意事项

- 不要提交 Token、Cookie、账号密码、私钥或其他敏感信息。
- 不要提交个人设备路径、临时文件和构建产物。
- 修改脚本时尽量保留原有目录结构，避免破坏其他入口。
- 第三方代码或资源请注明来源和许可证。

## 相关链接

- [安装 Scripting App](https://apps.apple.com/app/apple-store/id6479691128)
- [一键导入脚本库](https://scripting.fun/import_scripts?urls=%5B%22https%3A%2F%2Fgithub.com%2F7452323%2FScripting-Script-Library%2Ftree%2Fmain%2FScripting%2FScripts%22%5D)
- [脚本目录](Scripting/Scripts/)
- [贡献与新增规范](CONTRIBUTING.md)

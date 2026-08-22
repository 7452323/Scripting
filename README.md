# Scripting Script Library

这里是我个人整理的 Scripting App 脚本仓库。

## 怎么用

这个仓库本身不是一个需要运行的 Scripting 项目，不要把仓库根目录直接运行。

使用某个脚本时：

1. 打开对应目录。
2. 阅读该目录里的 `README.md`。
3. 下载或复制这个脚本目录到 Scripting App 的脚本目录。
4. 在 Scripting App 中运行该脚本。

每个可运行脚本都应当是一个独立目录，通常包含：

```text
脚本名称/
├── script.json
├── index.tsx
└── 其他 .ts 或 .tsx 文件
```

## 目录

- `examples/`：最小示例和通用模板
- `widgets/`：主屏幕小组件
- `intents/`：快捷指令、分享面板入口
- `tools/`：日常工具脚本

## 添加脚本

新建一个独立目录，不要把多个脚本的文件混在仓库根目录：

```text
examples/My Script/script.json
examples/My Script/index.tsx
examples/My Script/README.md
```

脚本应尽量使用 Scripting 官方 API，敏感信息、Token、Cookie 和本地路径不要提交到 GitHub。

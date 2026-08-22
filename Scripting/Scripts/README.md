# Scripting 脚本库

这里是本仓库的主要脚本目录。每个子目录都是一个相对独立的 Scripting App 项目。

## 使用方式

1. 找到需要的脚本目录。
2. 阅读其中的 `README.md`，确认配置和权限要求。
3. 下载整个脚本目录。
4. 将目录放入 Scripting 的脚本目录后运行。

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

修改已有脚本时，请尽量保留原目录结构，并同步更新脚本自己的 README。敏感信息、Token、Cookie、账号密码和个人本地路径不要提交。

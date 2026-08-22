# Scripting 脚本库

这里是本仓库的主要脚本目录。每个子目录都是一个独立的 Scripting App 项目。

## 怎么用

1. 先安装 [Scripting App](https://apps.apple.com/app/apple-store/id6479691128)。
2. 返回仓库首页的[脚本清单](../../README.md#脚本清单)。
3. 点击具体脚本名称，导入对应脚本。

Scripting 不支持把这个目录内的所有脚本一次性导入，所以每个脚本都使用单独的导入链接。脚本名称、描述和导入链接统一维护在仓库首页。

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

新增脚本时需要：

- 创建独立目录并保留全部依赖文件。
- 在脚本自己的 README 中写清用途、配置和权限。
- 在仓库根目录 `README.md` 的“脚本清单”中添加脚本名、描述和单独导入链接。

修改已有脚本时，请尽量保留原目录结构。敏感信息、Token、Cookie、账号密码和个人本地路径不要提交。
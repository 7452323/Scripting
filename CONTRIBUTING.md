# 收录和维护脚本

这个仓库是 Scripting 脚本的长期归档库。以后新写的 Scripting 脚本统一放到 `Scripting/Scripts/` 下，每个脚本使用一个独立目录。

## 新增脚本

建议使用下面的结构：

```text
Scripting/Scripts/我的脚本/
├── script.json
├── index.tsx
├── README.md
└── 其他项目文件/
```

其中：

- `script.json`：Scripting 项目配置。
- `index.tsx`：普通脚本的运行入口；如果项目使用其他入口，也请保留对应文件。
- `README.md`：说明脚本用途、使用方式、配置项和所需权限。
- 其他文件：组件、页面、服务、存储、Widget、Intent 和资源文件。

## 导入链接规则

Scripting 不支持把仓库目录内的所有脚本一次性导入。每个脚本都必须有自己的导入链接，链接指向该脚本目录：

```md
[我的脚本](https://scripting.fun/import_scripts?urls=%5B%22https%3A%2F%2Fgithub.com%2F7452323%2FScripting-Script-Library%2Ftree%2Fmain%2FScripting%2FScripts%2F我的脚本%22%5D)
```

仓库首页的脚本清单使用“脚本名 + 描述”的形式，脚本名本身就是导入链接。目录名包含中文或空格时，必须进行 URL 编码。

脚本自己的 README 可以提供同样的单独导入链接，并附上安装入口：

```md
[安装 Scripting App](https://apps.apple.com/app/apple-store/id6479691128)
```

## 提交前检查

- 确认脚本目录可以独立导入，不要把整个 `Scripting/Scripts` 目录作为导入对象。
- 确认入口文件和依赖文件都已提交，不要只提交 `index.tsx`。
- 在根目录 README 的“脚本清单”中添加脚本名称、简短描述和单独导入链接。
- 删除调试输出、临时文件和本地构建产物。
- 检查代码中没有 Token、Cookie、账号密码、私钥或个人路径。
- 如果依赖外部 API、订阅地址或特殊权限，在脚本 README 中写明。
- 如果使用第三方代码或资源，注明来源和许可证。

## 目录和命名

- 脚本放在 `Scripting/Scripts/脚本名称/`。
- 一个脚本一个目录，不要把多个项目混在一起。
- 目录名保持清晰稳定，避免无意义的日期或临时后缀。
- 修改已有脚本时，尽量保留原来的目录结构和入口文件。

## 提交信息

提交信息直接说明变更内容，例如：

```text
新增天气查询脚本
修复联系人管理器存储问题
更新 Surge Pro 地图资源
```
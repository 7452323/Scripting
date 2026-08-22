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
- `README.md`：说明脚本用途、使用方式、配置项、所需权限和一键导入链接。
- 其他文件：组件、页面、服务、存储、Widget、Intent 和资源文件。

## README 必填内容

每个新脚本的 README 顶部都应包含可直接点击的导入链接：

```md
# 我的脚本

[一键导入](https://scripting.fun/import_scripts?urls=%5B%22https%3A%2F%2Fgithub.com%2F7452323%2FScripting-Script-Library%2Ftree%2Fmain%2FScripting%2FScripts%2F我的脚本%22%5D)

需要先安装？[安装 Scripting App](https://apps.apple.com/app/apple-store/id6479691128)
```

链接格式使用 Scripting 的 `import_scripts` 导入入口。将最后的 `我的脚本` 替换为实际目录名，并进行 URL 编码。

## 提交前检查

- 确认脚本目录可以独立通过一键导入链接或 Scripting 导入。
- 确认入口文件和依赖文件都已提交，不要只提交 `index.tsx`。
- 删除调试输出、临时文件和本地构建产物。
- 检查代码中没有 Token、Cookie、账号密码、私钥或个人路径。
- 如果依赖外部 API、订阅地址或特殊权限，在脚本 README 中写明。
- 如果使用第三方代码或资源，注明来源和许可证。

## 目录和命名

- 脚本放在 `Scripting/Scripts/脚本名称/`。
- 一个脚本一个目录，不要把多个项目混在一起。
- 目录名保持清晰稳定，避免无意义的日期或临时后缀。
- 修改已有脚本时，尽量保留它原来的目录结构和入口文件。

## 提交信息

提交信息直接说明变更内容，例如：

```text
新增天气查询脚本
修复联系人管理器存储问题
更新 Surge Pro 地图资源
```

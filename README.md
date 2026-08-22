# Scripting Script Library

一个用于浏览 `7452323` GitHub 公开仓库的 Scripting App 脚本库。

## 功能

- 从 GitHub 公共 API 加载账号下的公开仓库
- 按仓库名称、描述和主要语言搜索
- 按最近更新或 Star 数排序
- 查看仓库详情、语言、Star 和更新时间
- 在 Scripting App 内打开 GitHub 仓库页面
- 网络不可用时使用内置示例数据

## 安装

将 `Scripting Script Library` 目录导入 Scripting App，或把本目录中的脚本文件放入 Scripting 的脚本目录。

## 结构

- `script.json`：Scripting 脚本元数据
- `index.tsx`：脚本入口与界面
- `types.ts`：仓库数据类型
- `data.ts`：GitHub API 请求和 fallback 数据

## 数据来源

数据来自 GitHub 公共 API：

`https://api.github.com/users/7452323/repos?per_page=100&sort=updated`

本项目仅展示公开仓库信息，仓库内容和许可证归原作者所有。

# 和风天气小尺寸组件重新设计

[安装 Scripting App](https://apps.apple.com/app/apple-store/id6479691128) · [一键导入当前脚本](https://scripting.fun/import_scripts?urls=%5B%22https%3A%2F%2Fgithub.com%2F7452323%2FScripting-Script-Library%2Ftree%2Fmain%2FScripting%2FScripts%2F%E5%92%8C%E9%A3%8E%E5%A4%A9%E6%B0%94%22%5D)

## 状态：✅ 已完成

### 完成内容

1. ✅ 按参考图重做 `SmallWidget` 布局（顶部定位、AQI 标签、预警标签、右侧天气图标与状态、底部温度区）
2. ✅ 调整字号/间距，确保小尺寸组件视觉风格接近 iOS 原生
3. ✅ 预警文案做短标题处理，避免小组件内文字截断
4. ✅ TypeScript 编译检查通过（无诊断错误）

### 变更文件

- `widget.tsx`：仅重构 `SmallWidget`，中/大组件逻辑保持不变

### 备注

- 预警标题会优先显示短文案（如 `大风蓝色预警`），以匹配参考图样式。
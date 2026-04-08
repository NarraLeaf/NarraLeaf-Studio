---
title: feat: Appearance Motion Authoring
type: feat
status: completed
date: 2026-04-07
---

# feat: Appearance Motion Authoring

## Overview
为 `nl.container` 与 `nl.button` 的 `appearance` 系统补齐字段级过渡 authoring，使状态切换与 variant 切换共享同一套字段 transition 配置，而不引入独立时间轴系统。

## Landed Decisions
- 过渡配置挂在 `AppearancePropertyGroup` 上，与字段 key 一一对应。
- 模块 header 新增 hover 才显露的 animated 菜单入口，用于切换该模块字段级 motion 控件的可见性。
- 模块开启 animated controls 后，每个可动画字段旁都会显示一个常驻小 icon，点击后用 anchored portal 浮窗编辑该字段的 transition。
- 字段 transition 目前支持两类：
  - `tween`: `durationMs`、`delayMs`、`easing`
  - `spring`: `stiffness`、`damping`、`mass`、`delayMs`
- `AppearanceResolver` 继续只负责解“最终值”；transition 收集与渲染应用独立处理。
- 运行时通过 `motion/react` 将字段级 transition 应用于 container/button 共享的 chrome 渲染路径。

## Key Files
- 数据模型：`src/shared/types/ui-editor/appearance.ts`
- transition patch/helper：
  - `src/renderer/lib/ui-editor/widget-modules/shared/appearance/appearancePatch.ts`
  - `src/renderer/lib/ui-editor/widget-modules/shared/appearance/appearanceMotion.ts`
  - `src/renderer/lib/ui-editor/widget-modules/shared/appearance/runtimeMotionHelpers.ts`
- authoring UI：
  - `src/renderer/lib/ui-editor/widget-modules/shared/appearance/AppearanceAuthoringPanel.tsx`
  - `src/renderer/lib/ui-editor/widget-modules/shared/appearance/compact/AppearanceMotionControls.tsx`
  - `src/renderer/lib/ui-editor/widget-modules/shared/appearance/compact/CompactModuleCard.tsx`
  - `src/renderer/lib/ui-editor/widget-modules/shared/appearance/compact/CompactBackgroundAppearance.tsx`
  - `src/renderer/lib/ui-editor/widget-modules/shared/appearance/compact/CompactContainerAppearance.tsx`
  - `src/renderer/lib/ui-editor/widget-modules/shared/appearance/compact/CompactButtonAppearance.tsx`
- runtime：
  - `src/renderer/lib/ui-editor/runtime/appearance/AppearanceResolver.ts`
  - `src/renderer/lib/ui-editor/widget-modules/shared/chrome/RectangleChromeRenderer.tsx`
  - `src/renderer/lib/ui-editor/widget-modules/builtin/container/renderer.tsx`
  - `src/renderer/lib/ui-editor/widget-modules/builtin/button/renderer.tsx`

## Data Model
`AppearancePropertyGroup` 新增可选 `transition`：

- `tween`
  - `durationMs`
  - `delayMs`
  - `easing`
- `spring`
  - `stiffness`
  - `damping`
  - `mass`
  - `delayMs`

首版仅为以下字段开放 motion authoring：

- Container
  - `backgroundColor`
  - `fillOpacity`
  - `fillVisible`
  - `borderWidth`
  - `borderColor`
  - `strokeOpacity`
  - `strokeVisible`
  - `borderRadius`
  - `borderRadiusTL`
  - `borderRadiusTR`
  - `borderRadiusBL`
  - `borderRadiusBR`
- Button
  - `backgroundColor`
  - `fillOpacity`
  - `fillVisible`
  - `borderRadius`
  - `borderWidth`
  - `borderColor`
  - `paddingX`
  - `paddingY`

以下字段仍保持硬切：

- `fillType`
- `imageFill`
- `backgroundImage`
- `backgroundFit`
- `borderStyle`
- `strokeAlign`
- `strokeSide`
- `borderJoin`
- `borderRadiusLinked`
- `cornerAdvanced`
- `clipContent`

## Authoring UX
### Module Header
- `CompactModuleCard` 新增 hover/focus 才显示的 header action 插槽。
- `AppearanceMotionControls.tsx` 提供 `ModuleMotionMenuButton`，复用现有 `ContextMenu` / `InlineMenuTriggerButton`。
- 菜单使用项目现有 `icon + label` 结构，勾选状态通过调用方注入 `Check` 图标实现。

### Field Motion Popover
- `AppearanceFieldMotionButton` 作为字段旁的小 icon trigger。
- 浮窗定位模式复用属性面板既有 anchored portal 思路：
  - 以 trigger 为锚点
  - 视口内自动调整上下/左右位置
  - 点击外部关闭
  - `Escape` 关闭
- 默认关闭时不写 transition；点开后可先启用默认 `tween`，再切换到 `spring`。

## Runtime Integration
### Resolver Boundary
- `AppearanceResolver` 新增 active variant transition 收集函数：
  - `resolveContainerAppearanceTransitions()`
  - `resolveButtonAppearanceTransitions()`
- 仍然保留原有 value resolution，不在 resolver 内做动画决策。

### Renderer Application
- `RectangleChromeRenderer` 现在可以接收 `appearanceTransitions`。
- container 与 button 都把 active variant 的 transition map 传给共享 chrome renderer。
- button 额外在内部 content wrapper 上应用 `paddingX / paddingY` 的 motion transition。
- 运行时实际使用 `motion/react`，将字段 transition 转换为 motion `transition`：
  - `tween` -> `type: "tween"`
  - `spring` -> `type: "spring"`

## Known Constraints
- 多个字段共同影响同一视觉属性时，首版使用“相关字段优先级”来选择应用到该 motion property 的 transition，而不是做更复杂的 source-of-change 跟踪。
- `tile` 背景图仍走静态 background 路径，未做独立 opacity motion。
- 模块 header 的 animated 开关当前控制的是字段 motion 控件可见性，而不是单独持久化一个 module-level animation 开关。

## Verification
- `yarn lint`

## Follow-up Sync
后续若该能力稳定，建议把以下结论回写到长期文档：

- `project/docs/visual-editor-arch.md`
- `project/docs/visual-editor.md`

重点同步内容：
- appearance transition 的字段级模型
- compact inspector 中 animated controls 的交互入口
- runtime 采用 `motion/react` 的边界与非目标

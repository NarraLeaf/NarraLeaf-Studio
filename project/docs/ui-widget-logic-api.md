# UI 控件逻辑 API（首版）

## 概述

本文档描述当前仓库中已经落地的 **统一 UI 控件逻辑 API**。

本轮实现把原先分散在 `supportsBlueprintLogic`、`blueprintEvents`、运行时派发、属性面板文案、事件头过滤中的逻辑能力，统一收敛到 `src/shared/types/ui-editor/widgetLogic.ts` 的 `WidgetLogicApi`。

目标心智现在是：

- 每个支持逻辑的控件实例只拥有一张自己的 `widgetMain` 私有蓝图
- 该蓝图内部直接承载该控件支持的事件成员
- 编辑器、运行时、诊断、调色板都从同一份控件能力声明派生

---

## 统一模型

`WidgetLogicApi` 由以下几部分组成：

- `supportsPrivateBlueprint`
  - 该控件是否拥有私有 `widgetMain` 蓝图
- `blueprintLabel`
  - 编辑器中显示给用户的蓝图名称
- `events`
  - 该控件支持的事件成员
- `commands`
  - 蓝图/TypeScript 可调用的控件命令
- `readableState`
  - 蓝图侧可读取的控件状态
- `writableProps`
  - 可被绑定或作为后续写入口的控件属性

当前统一能力定义位于：

- `src/shared/types/ui-editor/widgetLogic.ts`

---

## 事件模型

### 私有事件成员

对 `widgetMain` 而言，事件现在被视为蓝图内部的固有成员，而不是外部接线到某个 loose layer。

当前首版事件成员：

- `init`
  - 生命周期事件
  - 事件头：`blueprint.event.head.init`
- `click`
  - 交互事件
  - 事件头：`blueprint.event.head.click`

### 运行时行为

- Dev Mode 会优先按 `owner + slotId` 派发到控件自己的私有蓝图事件成员
- 旧的 `uidoc` `behavior.events[*] -> blueprintEvent` 仍保留兼容读取与迁移桥
- TypeScript Blueprint 与 Visual Blueprint 共用同名事件成员

### 编辑器行为

- 属性面板不再让用户手动“Attach existing / New layer”
- 用户看到的是控件自己的事件成员，并直接打开该事件
- Blueprint Tab 对 widget private blueprint 优先展示 `Events`

---

## 通用命令 API

以下命令已经接入统一 schema，并映射到现有 Host API：

### `widget.setVisible`

- schema 状态：`available`
- capability id：`widget.setVisible`
- 作用：切换控件可见性

当前运行时约束：

- 对 **非 appearance-capable** 控件可用
- 对 `nl.container`、`nl.button` 会报错，提示改用 `widget.setVariant`

### `widget.setEnabled`

- schema 状态：`available`
- capability id：`widget.setEnabled`
- 作用：切换控件是否可交互

当前运行时约束：

- 对 **非 appearance-capable** 控件可用
- 对 `nl.container`、`nl.button` 会报错，提示改用 `widget.setVariant`

### `widget.setVariant`

- schema 状态：`available`
- capability id：`widget.setVariant`
- 作用：切换运行时 appearance variant

当前运行时约束：

- 仅当控件类型支持 appearance variant 且目标 variant 存在时可用
- 当前 appearance-capable 类型为：
  - `nl.container`
  - `nl.button`

---

## 控件 API 矩阵

以下内容均来自当前 `BUILTIN_WIDGET_LOGIC_APIS`。

### `nl.root`

- 私有蓝图：否
- 事件：无
- 命令：无
- 可读状态：无
- 可写属性：无

### `nl.container`

- 私有蓝图：是
- 蓝图名称：`Container blueprint`
- 事件：
  - `init`
- 命令：
  - `setVisible` `available`
  - `setEnabled` `available`
  - `setVariant` `available`
- 可读状态：
  - `visible`
  - `enabled`
  - `variant`
- 可写属性：
  - `appearance`
  - `clipContent`

说明：

- 当前运行时真正推荐的主控制入口是 `setVariant`
- `setVisible` / `setEnabled` 虽在 schema 中存在，但在当前 Host 实现里对 appearance-capable 控件会被拒绝

### `nl.text`

- 私有蓝图：是
- 蓝图名称：`Text blueprint`
- 事件：
  - `init`
- 命令：
  - `setVisible` `available`
  - `setEnabled` `available`
  - `setVariant` `available`
  - `setText` `planned`
- 可读状态：
  - `visible`
  - `enabled`
  - `text`
- 可写属性：
  - `text`

说明：

- `setText` 目前只是 schema 中的首版占位，尚未接入真实 runtime 写入实现

### `nl.image`

- 私有蓝图：是
- 蓝图名称：`Image blueprint`
- 事件：
  - `init`
- 命令：
  - `setVisible` `available`
  - `setEnabled` `available`
  - `setVariant` `available`
  - `setSource` `planned`
- 可读状态：
  - `visible`
  - `enabled`
  - `imageSource`
- 可写属性：
  - `imageFill.assetId`

说明：

- `setSource` 目前只是 schema 中的首版占位，尚未接入真实 runtime 写入实现

### `nl.button`

- 私有蓝图：是
- 蓝图名称：`Button blueprint`
- 事件：
  - `init`
  - `click`
- 命令：
  - `setVisible` `available`
  - `setEnabled` `available`
  - `setVariant` `available`
  - `setLabel` `planned`
- 可读状态：
  - `visible`
  - `enabled`
  - `label`
  - `variant`
- 可写属性：
  - `label`
  - `appearance`
  - `interactionDisabled`

说明：

- `click` 是当前唯一已经具备真实用户交互语义的首版事件
- `setLabel` 目前只是 schema 中的首版占位，尚未接入真实 runtime 写入实现
- 与 `nl.container` 一样，按钮是 appearance-capable，当前运行时更偏向通过 `setVariant` 控制表现

### `nl.list`

- 私有蓝图：否
- 蓝图名称：`List blueprint`
- 事件：无
- 命令：
  - `refreshItems` `planned`
- 可读状态：
  - `itemCount`
- 可写属性：
  - `previewCount`

说明：

- `nl.list` 本轮仅纳入统一能力矩阵
- 当前仍不是 logic-capable widget
- 相关命令与状态主要用于为后续列表交互化预留入口

---

## 编辑器里新增可见能力

属性面板中的 Blueprint 区块现在会直接显示当前控件的：

- `Events`
- `Commands`
- `Readable state`
- `Writable props`

其中：

- 已接入 runtime 的命令直接按正常名称展示
- 尚未接入 runtime 的命令会显示为 `planned`

这部分 UI 由以下代码驱动：

- `src/renderer/lib/ui-editor/widget-modules/shared/blueprint/ReadonlyBlueprintSection.tsx`

---

## 兼容与迁移

为了兼容旧项目，本轮保留了旧模型的兼容桥：

- 旧的 `behavior.events[*] -> blueprintEvent` 仍可被读取
- 生命周期同步会尝试把旧 `eventId` 迁移或吸收到新的 owner-local 事件成员
- 运行时派发会优先使用新的私有事件成员；若不存在，再回退读取 legacy binding

这意味着：

- 新 authoring path 已切到私有蓝图事件成员
- 旧数据暂时不会立即失效
- 编辑器会提示 legacy hook 仅为兼容用途

---

## 当前限制

本文档描述的是“首版统一 API 模型”，不是“所有能力都已实现完毕”的最终状态。

当前仍需注意：

- schema 中部分命令仍是 `planned`
- 目前首批真实交互事件只有按钮的 `click`
- `nl.list` 已进入统一矩阵，但尚未升级为真正 logic-capable widget
- `setVisible` / `setEnabled` / `setVariant` 的 schema 暴露已统一，但具体控件在当前 Host 实现里的可用性仍受 appearance 策略限制

---

## 相关实现文件

- `src/shared/types/ui-editor/widgetLogic.ts`
- `src/renderer/lib/ui-editor/widget-modules/types.ts`
- `src/renderer/lib/ui-editor/widget-modules/shared/blueprint/ReadonlyBlueprintSection.tsx`
- `src/renderer/apps/workspace/modules/properties/blueprint/BlueprintEventBindingField.tsx`
- `src/renderer/apps/workspace/modules/properties/blueprint/useBlueprintEventBindingState.ts`
- `src/renderer/apps/workspace/modules/blueprint-lite/editors/BlueprintEntryTab.tsx`
- `src/renderer/apps/workspace/modules/blueprint-lite/components/BlueprintMemberTree.tsx`
- `src/shared/types/blueprint/graph.ts`
- `src/renderer/lib/ui-editor/blueprint-nodes/built-in/events/eventHeadNodes.ts`
- `src/renderer/lib/ui-editor/blueprint-runtime/BlueprintDispatcher.ts`
- `src/renderer/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge.ts`

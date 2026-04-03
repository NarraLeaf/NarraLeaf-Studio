# NarraLeaf Studio - Visual Editor Milestones（Editor Only）

## 1. 文档目标

这份文档给 `Visual Editor` 下一阶段提供一个 **只限编辑器范围** 的里程碑拆分。

它不负责替代：

- `project/docs/blueprint-system-milestones.md`
- `project/docs/blueprint-system.md`

而是作为它们在“界面编辑器侧”的配套文档。

---

## 2. 前置共识

当前里程碑建立在以下共识上：

- 主路线：继续以 **通用 UI Editor** 为核心
- 不建立新的视觉小说领域主模型
- 编辑器内预览只做 **静态/布局预览**
- 第一阶段复用只依赖 **Surface Link + 复制粘贴**
- 视觉小说创作效率优先通过 `widget + 组合范式 + validation + preview` 提升
- Blueprint Runtime、真实执行、DevTools 深调试不在本文档内展开
- Dev Mode 仍然是未来主要真实调试入口

---

## 3. 里程碑总览

建议把编辑器侧拆为 `M1 ~ M6`。

- `M1`：方向冻结与体验基线
- `M2`：通用基础 widget 扩展
- `M3`：Surface 复用约定与组合范式
- `M4`：Blueprint 入口与编辑器内状态可见性
- `M5`：验证、静态预览、创作反馈
- `M6`：生产级收口与团队可复用性

---

## 4. M1：方向冻结与体验基线

### 4.1 目标

让团队在进入大规模实现前，先把编辑器自身的产品定位与最小体验基线冻结。

### 4.2 必须完成

- 冻结“通用 UI Editor 核心路线”
- 冻结编辑器范围内的非目标
- 盘点当前占位符、缺失能力、文档与实现偏差
- **确立并锁定第一批基础 widget 范围（M2 输入）**：共 8 项 — Text、Image、Button、Container/Frame、Stack、Scroll、Spacer/Divider、Option List/Repeater 最小形态
- 冻结“编辑器只做静态/布局预览”
- 冻结“第一阶段不引入模板/preset 系统”
- **与 Blueprint 文档分工明确**：Blueprint System M1 契约见 `blueprint-system*.md`；Visual Editor M1 不重开该范围

### 4.3 主要产物

- 一份稳定的实现指南（`project/docs/visual-editor-implementation-guide.md`，含 M1 冻结表）
- 一份稳定的 milestone 文档（本文）
- 一份待确认决策清单（实现指南 §11，不含已锁定的第一批 widget 清单）
- 一份编辑器质量基线（文档 + 关键 UI 文案/占位态与代码一致）

### 4.4 验收标准

- 团队不再争论“Visual Editor 到底是不是 VN 专用编辑器”
- 后续 agent 能明确区分“编辑器内工作”与“运行时蓝图工作”
- 第一阶段能力边界被写清楚
- **可按文件核对**：`visual-editor.md` §0 与本文 §4、`visual-editor-implementation-guide.md` §2.1 三者对 M1 边界、预览策略、复用策略、M2 八件套一致
- **界面不误导**：左栏 Surface 与画布 Tab 的文案体现“编辑器静态预览 / Dev Mode 运行时”；属性面板 Blueprint 区域不为“仅加号”的虚假可点入口（M1 为延期说明，M4 升级为真入口）

### 4.5 代码与文档锚点（便于验收）

| 用途 | 路径 |
|------|------|
| 实现基线 + M1 快照 | `project/docs/visual-editor.md`（§0） |
| M1 冻结决策表 | `project/docs/visual-editor-implementation-guide.md`（§2.1） |
| 内置 widget 清单（当前仅 rectangle） | `src/renderer/lib/ui-editor/widget-modules/builtin/index.ts` |
| Surface 列表面板 | `src/renderer/apps/workspace/modules/ui-editor/UISurfacesPanel.tsx`，`panel/SurfaceList.tsx`，`panel/SurfaceActions.tsx` |
| 画布 Tab | `src/renderer/apps/workspace/modules/ui-editor/editors/UISurfaceEditorTab.tsx` |
| 属性面板 | `src/renderer/apps/workspace/modules/properties/PropertiesPanel.tsx` |
| Rectangle Inspector / Blueprint 延期区 | `src/renderer/lib/ui-editor/widget-modules/builtin/rectangle/inspector.tsx` |

---

## 5. M2：通用基础 Widget 扩展

### 5.1 目标

把当前偏“矩形驱动”的编辑器，升级为一个足以承载真实 UI 生产的通用编辑器。

### 5.2 建议优先范围（已由 M1 锁定）

与 M1 冻结的第一批一致，共 8 项（**实现顺序在 M2 内再定**）：

#### 5.2.1 M2-A（本阶段子集，已落地）

以下 4 项与 **Blueprint System M2**（本地实例蓝图、`widgetMain` 生命周期、只读摘要、`blueprintEvent` 持久化）在同一工程阶段交付：

- Text（`nl.text`）
- Image（`nl.image`）
- Button — 容器式（`nl.button`）
- Container / Frame（`nl.container`）

其余 4 项（Stack、Scroll、Spacer/Divider、Option List/Repeater）仍在 **M2 后续**，不在 M2-A 范围。

#### 5.2.2 完整 M2 八件套（含未交付项）

- Text
- Image
- Button
- Container / Frame
- Stack / Auto Layout 容器
- Scroll Container
- Spacer / Divider
- Option List / Repeater 最小形态

### 5.3 设计原则

- 先做最小可用，不追求一次覆盖全部复杂样式
- 每个 widget 都必须有清晰的 inspector
- 每个 widget 都必须能被插入、选中、编辑、复制、删除
- 图片、文字、交互三类能力要同时开始覆盖

### 5.4 不建议在 M2 做的事

- 大量 VN 强语义控件
- 完整蓝图逻辑编辑器
- 高级组件继承系统

### 5.5 验收标准

- 用户可以不依赖“只用 rectangle 拼 UI”
- 至少能搭出常见菜单、对话框、按钮列、图片背景等基本界面

### 5.6 M2 代码接力锚点（从 M1 接入）

实施 M2 时优先打开的文件族（不必一次全改）：

- `src/renderer/lib/ui-editor/widget-modules/builtin/index.ts` — 注册新 `BuiltinWidgetModules` 项
- `src/renderer/lib/ui-editor/widget-modules/builtin/*` — 各 widget 的 `createDefaultElement`、`render`、`createInspector`
- `src/renderer/lib/ui-editor/widget-modules/types.ts` — `UIWidgetModule` 契约
- `src/renderer/lib/ui-editor/element-types/builtin/index.ts`、`src/renderer/lib/ui-editor/runtime/builtin/index.ts` — 与 builtin 映射保持一致
- `src/renderer/lib/workspace/services/ui-editor/UIDocumentService.ts` — 创建元素时的类型校验与默认数据
- `src/renderer/apps/workspace/modules/ui-editor/editors/UISurfaceEditorTab.tsx` — 右键 Insert 列表来源
- `src/renderer/apps/workspace/modules/properties/PropertiesPanel.tsx` — 与 inspector schema 的集成方式

### 5.7 M1 结束时的已知缺口（供 M2 对照）

- ~~内置可插 widget 当前仅有 `nl.rectangle`。~~ **M2-A 已补齐** Text / Image / Button / Container；其余 M2 项仍待实现。
- 行为图/蓝图在编辑器侧无完整图编辑 UI；属性面板 Blueprint **M4-lite 已交付**真入口（轻量 Tab）；完整绑定 UI 与 Visual 画布属 **M4-full**。

---

## 6. M3：Surface 复用约定与组合范式

### 6.1 目标

在不引入模板系统的前提下，尽量提高视觉小说 UI 的搭建效率，并降低团队内的拼装分歧。

### 6.2 推荐交付

- Dialog Surface 参考结构
- Choice Menu 参考结构
- Notification / Toast 参考结构
- Settings 参考结构
- Save / Load 参考结构
- Overlay / Pause Menu 参考结构
- 基于 Surface Link 的常见复用约定

### 6.3 推荐做法

- 先沉淀“官方推荐结构”，而不是模板系统
- 优先沉淀高频组合，而不是高语义主模型
- 优先让团队能靠基础 widget 稳定拼出同一类界面

### 6.4 风险点

- 没有模板系统时，效率提升会低于更激进路线
- 如果没有清晰范式，团队仍会回到随意拼装

### 6.5 验收标准

- 常见 VN 界面能按照统一范式稳定搭建
- 团队能逐步形成一致的 Surface 组织方式和命名习惯

---

## 7. M4：Blueprint 入口与编辑器内状态可见性

### 7.1 目标

把当前 placeholder 级别的 Blueprint 入口，升级为真实的编辑器入口层。

### 7.2 必须完成

- Blueprint placeholder 升级为真实入口
- 当前 Surface / 当前元素的逻辑状态可见
- 事件/绑定是否存在可以被用户识别
- 从当前上下文跳转到 Blueprint 编辑入口

### 7.3 第一阶段推荐边界

这一里程碑只解决：

- 入口
- 状态提示
- 上下文跳转
- 最小绑定/事件展示

**M4-lite（已落地）**：上述四条在 Workspace 内通过「只读摘要 + Open blueprint entry → 轻量 Tab」完成；**不**包含属性面板绑定编辑与 Visual 画布。真实执行闭环在 **Dev Mode**（见 Blueprint M3-min 与 `project/docs/implementation-plans/p2-bp-m3min-ve-m4lite-plan.md`）。

### 7.4 验收标准

- 用户不会再看到“只有一个无意义加号按钮”的 Blueprint 区块
- 用户能知道当前元素是否接了逻辑
- 用户能从当前编辑上下文进入对应逻辑入口

**说明**：M1 阶段允许属性面板内为 Blueprint 提供**明确的延期/未实现说明**（非可点的虚假入口）；M4 完成时须满足上表三条。**M4-full** 仍待：绑定 UI、声明选择器、React Flow 编辑器等（见 Blueprint System M4）。

---

## 8. M5：验证、静态预览、创作反馈

### 8.1 目标

让编辑器从“能画”变成“能发现问题”。

### 8.2 推荐交付

- 缺失资源提示
- link 异常提示
- Surface / Stage 配置异常提示
- 元素越界与可见性问题提示
- 交互热点与尺寸检查
- 面向 Dev Mode 的更清晰预览入口

### 8.3 预览策略建议

这一里程碑已经采用明确策略：

- 编辑器只做静态/布局预览
- 真实交互和副作用统一交给 Dev Mode
- 不在此阶段把编辑器变成第二个 Dev Mode

### 8.4 验收标准

- 用户能更早发现明显错误
- 编辑器内反馈与 Dev Mode 的职责边界清楚
- 预览结果不再严重误导用户

---

## 9. M6：生产级收口与团队可复用性

### 9.1 目标

把前面几个里程碑产出的能力收口成可持续使用的团队工作流。

### 9.2 推荐交付

- 稳定的官方组合范式与参考示例
- 更顺手的插入/搜索/复制复用入口
- 更一致的属性面板体验
- 更明确的错误与空状态文案
- 团队级最佳实践文档

### 9.3 推荐关注点

- 新手是否能快速搭出一个可用 VN 界面
- 老手是否能快速复用已有模式
- 编辑器是否已经形成一致的产品语言
- 未来 Blueprint 集成是否还有清晰入口位

### 9.4 验收标准

- 团队可以把它当成真实生产工具，而不是实验性编辑器
- 新增 widget、组合范式、Blueprint 入口的扩展方式足够稳定

---

## 10. 推荐顺序

建议严格按下面顺序推进：

1. 先冻结方向与体验基线
2. 再补通用基础 widget
3. 再补 Surface 复用约定与组合范式
4. 再把 Blueprint 入口做实
5. 再增强预览、验证与创作反馈
6. 最后做生产级收口

不要倒过来先做很重的蓝图入口或很重的 VN 领域控件，否则会出现：

- 承载控件不够，但入口变复杂
- 预览很花，但真实创作效率没有提升
- 组合范式不清，团队持续回到手工拼装

---

## 11. 关键决策门

在 `M1 ~ M6` 期间，以下决策门仍开放（**第一批基础 widget 清单已在 M1 锁定为 8 项**，见 §4.2 / §5.2）：

- Blueprint 入口在 M4 第一阶段只做跳转，还是同时做最小绑定配置
- 文本类 widget 是否在 M2 就预留本地化结构
- 未来是否要重新引入模板/preset 或组件系统

这些问题一旦确认，后续 milestone 可以进一步细化成执行计划。

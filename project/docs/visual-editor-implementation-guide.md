# NarraLeaf Studio - Visual Editor 下一步落地指南

## 1. 文档目标

这份文档不是运行时蓝图方案，也不是逐文件施工单。

它的目标只有三个：

- 帮团队明确 `Visual Editor` 在下一阶段应该承担什么，不应该承担什么
- 基于当前仓库真实状态，梳理缺失能力、占位符与优先实现方向
- 为后续实现 agent 提供稳定的产品边界、技术选型框架与阶段目标

---

## 2. 适用范围与边界

本文档只讨论 **界面编辑器之内** 的规划，不展开：

- Blueprint Runtime 的真实执行闭环
- TypeScript Blueprint
- 共享蓝图资产系统
- 剧情运行时、脚本解释器、叙事状态机

但本文档会假设这些系统未来会按 `project/docs/blueprint-system-milestones.md` 对接，因此会保留：

- Blueprint 入口位
- 绑定/事件的可扩展边界
- Dev Mode 作为主要真实预览与调试入口的前提

---

## 2.1 Visual Editor M1 已冻结结论（实施输入）

以下决策已作为 **Visual Editor M1** 写入文档与界面基线，后续里程碑应在此之上推进，避免反复摇摆：

| 决策项 | 冻结结论 |
|--------|----------|
| 范围 | 仅 Visual Editor / 界面编辑器侧；**Blueprint System M1** 已单独落地，不在此重开。 |
| M1 交付形态 | **冻结与基线**：文档对齐、质量基线、占位态/文案与静态预览边界一致；**不**在 M1 交付新 widget、Blueprint 真入口或模板系统。 |
| 预览 | **方案 A**：编辑器内仅静态/布局预览；真实交互与副作用统一去 **Dev Mode**。 |
| 复用 | **方案 A**：仅 **Surface Link + 复制粘贴**；M1 阶段不引入模板/preset/组件系统。 |
| M2 第一批 widget | **已锁定 8 项**：Text、Image、Button、Container/Frame、Stack、Scroll、Spacer/Divider、Option List/Repeater 最小形态（实现顺序在 M2 规划）。 |
| 控件扩展路线（M2 前） | 仍以「纯通用 widget」为主（对应原方案 A），与上表清单一致。 |

---

## 3. 当前状态判断

### 3.1 已经具备的基础

当前 `Visual Editor` 已经不是空壳，它已经具备一个可扩展的通用 UI 编辑器骨架：

- 以 `Surface` 为单位组织界面，已区分 `App Surface` 与 `Stage Surface`
- `Stage Surface` 已支持 link 到 `App Surface`
- `UIDocument` 与 `UIGraphDocument` 已有独立持久化与自动保存
- 画布渲染、选择、框选、拖拽、缩放、裁剪等核心交互已存在
- `Widget Module` 已经是明确的扩展入口
- 属性面板、Scene 属性、Surface 管理、Dev Mode 启动入口已接上

换句话说，当前最成熟的部分是：

- 通用 UI 文档模型
- 通用画布编辑体验
- Surface/Stage 语义
- 基于 widget module 的扩展架构

### 3.2 目前的关键缺口

在 **M2-B + M3** 落地后，通用布局积木与官方范式示例已补齐；仍可能存在的缺口主要在 **创作反馈与运行时** 侧：

- 内置 widget 已覆盖 M1 冻结的八件套（含 Stack、Scroll、Spacer/Divider、List/Repeater）；**不再**将“只有矩形”视为当前基线
- Blueprint **完整**图编辑与属性绑定 UI 仍属后续里程碑（M4-full 等）
- 编辑器内与 Dev Mode 内的 `hostAdapter.effects.runEffect` 仍是空实现
- `UIGraphService` 有数据层，但还没有工作区级图编辑体验
- 常用控件组合由 **`project/examples/visual-editor/`** 与 `visual-editor.md` §4.4 承载；**不**提供模板/preset 系统
- 缺少针对 UI 创作的校验、预览、资产联动、复用机制

### 3.3 一个重要结论

在 M2/M3 基线之上，更值得投入的是：

- 预览、验证、资源与 Link 健康度（M5）
- Blueprint 深度编辑与运行时闭环（M4-full / Dev Mode）
- 在**不**引入模板系统的前提下，持续维护 `project/examples/visual-editor/` 与文档的一致性

---

## 4. 已确认的主路线

### 4.1 用户已选方向

当前已确认采用：

- **A. 继续以通用 UI Editor 为核心**
- **编辑器内预览只做静态/布局预览**
- **复用第一阶段只依赖 Surface Link 与复制粘贴**

这意味着下一阶段 **不建立一套独立的视觉小说领域模型作为第一真相**，而是继续让：

- `Surface`
- `Element Tree`
- `Widget Module`
- 属性面板
- Stage/App 语义

保持为主干。

### 4.2 为什么这条路线成立

这条路线和当前仓库状态最一致，原因是：

- 现有实现已经在这条路上，重构成本最低
- 不会制造第二套与 `UIDocument` 平行的数据模型
- 更容易与后续 Blueprint 系统做低风险对接
- 更适合先把“可生产的 UI 编辑器”做扎实

### 4.3 这条路线的代价

采用这条路线也意味着必须接受以下现实：

- 编辑器不会天然理解“剧情段落”“对白 beat”“镜头段”等领域对象
- 视觉小说创作体验主要通过 `widget + 组合约定 + validation + preview` 补出来
- 第一阶段不会立刻拥有强复用能力，重复界面仍然需要手工组装
- 如果后续想做更强的叙事语义层，必须在通用 UI 核心上“增量叠加”，而不是推翻当前模型

---

## 5. 视觉小说创作下，编辑器内最重要的元素

在当前路线下，最重要的不是先做复杂蓝图，而是先补齐 **做 VN UI 时最常出现、最常复用、最影响效率** 的元素。

### 5.1 第一优先级：通用基础控件

这些控件会构成几乎所有 VN 界面的基本积木：

- Text
- Image
- Button
- Container / Frame
- Stack / Auto Layout 容器
- Scroll Container
- Spacer / Divider
- Option List / Repeater 的最小形态

如果这些控件不齐，后续无论是对白框、设置页、存读档页还是选择肢 UI，都会退化成手工拼矩形。

### 5.2 第二优先级：视觉小说高频界面范式

虽然当前不把模板/preset 作为第一阶段主策略，但仍然应该尽早沉淀 **高频界面的官方组合范式**，因为这是后续复用的基础：

- Dialog Surface 参考结构
- Choice Menu 参考结构
- Notification / Toast 参考结构
- Settings Surface 参考结构
- Save / Load Grid 参考结构
- Quick Menu / Pause Menu 参考结构
- Backlog / History 参考结构

这里的重点不是立即交付模板系统，而是先形成 **可重复手工搭建的官方范式**。

### 5.3 第三优先级：视觉小说常用视觉槽位

虽然不建议现在就引入“角色对象驱动 UI”的强语义，但编辑器至少要有足够顺手的视觉槽位能力：

- Background / CG 展示区
- Portrait / Character Slot
- Nameplate 区
- Dialogue Body 区
- Choice Row 区
- HUD / Quick Action 区

这些能力更适合通过：

- 通用 widget
- 组合约定
- 清晰命名的布局层级

来落地，而不是先引入独立剧情模型。

### 5.4 第四优先级：资产联动

视觉小说 UI 对资产引用非常频繁，因此编辑器必须把以下工作流做顺：

- 选图
- 替换图
- 预览图
- 查看资源丢失状态
- 区分背景图、CG、立绘、图标等常见用途

这里不要求先做强资产语义系统，但至少要让常见图片与音频引用工作流足够稳定、明显、低摩擦。

### 5.5 第五优先级：预览与验证

一个能画但不能判断“实际能不能用”的编辑器，对 VN 制作帮助有限。

必须逐步补上的编辑器内能力包括：

- Surface 越界与布局异常提示
- 缺失资源提示
- Stage slot / layer 使用不当提示
- 交互元素尺寸与可点击区域检查
- 绑定/事件入口的可见状态
- 面向 Dev Mode 的预览跳转与上下文启动

---

## 6. 推荐的能力分层

为了避免范围失控，建议把后续能力分成三层。

### 6.1 Core Editor Layer

这是通用 UI 编辑器必须持续增强的部分：

- 文档模型稳定
- Widget 扩展机制
- 画布交互
- 对齐、分布、复制、层级与分组
- 属性面板可扩展性

### 6.2 VN Production Layer

这是服务视觉小说制作效率的轻语义层，但仍然建立在通用 UI 上：

- 常用布局范式
- Surface 组织约定
- 资产快捷工作流
- 对话框/选择肢/菜单类组合控件
- 校验与预览规则

### 6.3 Future Blueprint Integration Layer

这是为未来蓝图系统留的接口层：

- Blueprint 入口按钮
- 事件/绑定状态展示
- 从属性面板或选中元素跳转到蓝图
- 基础错误与失效状态提示

这层只负责 **入口与上下文连接**，不在本文档中展开真实运行时实现。

---

## 7. 当前最值得优先解决的缺失功能

### 7.1 Widget 生态太薄

**M2 八件套已齐**（M2-A + M2-B），与 M1 冻结清单一致。后续更值得投入的是 **M5 校验**、**M4-full 蓝图编辑** 与资产联动，而不是继续堆叠新的主 widget 类型。

- M2-A：Text、Image、Button、Container
- M2-B：Stack、Scroll、SpacerDivider、ListRepeater（选择肢列表用后者组合实现）

### 7.2 Blueprint 入口还是占位

**M4-lite 已交付**：属性面板 Blueprint 区域为只读摘要 + 打开轻量 Tab 入口。**M4-full**（画布绑定编辑、声明选择器等）仍待。下列能力在 M4-full 前仍不完整：

- 在属性面板内直接编辑绑定与事件图
- Visual 画布上的蓝图叠加编辑

### 7.3 缺少高频界面范式

**M3 已通过文档 + `project/examples/visual-editor/` 示例 `uidoc.json` 沉淀**（无编辑器内 starter）。团队应以该目录与 `visual-editor.md` §4.4 为单一对照源，避免再引入一套口头约定。

### 7.4 缺少面向创作的验证反馈

目前更像“能画”，还不像“能审查”。

应补上的验证方向：

- 资源缺失
- link 失效
- 不可见但可交互
- 元素超出安全区
- Stage Surface 配置异常
- 未来 Blueprint 绑定入口失效

### 7.5 预览能力层次不清

当前编辑器可预览布局，也可以启动 Dev Mode，但“编辑器内该预览到什么程度”还没有冻结。
当前这个问题已经有了明确答案：**编辑器只做静态/布局预览，真实交互与副作用统一去 Dev Mode**。

这会影响：

- host adapter 的边界
- 占位事件是否可点
- 是否允许局部交互模拟
- 验证逻辑放在编辑器还是 Dev Mode

---

## 8. 关键技术选项与当前评估

### 8.1 控件扩展路线

可选方案：

- 方案 A：只加纯通用 widget，不做任何 VN 预设
- 方案 B：通用 widget 为主，同时提供 VN 高频模板与 preset
- 方案 C：直接新增强语义 VN widget，例如 `dialogBox`、`choiceBlock`、`characterPortrait`

评估：

- 方案 A 最干净，但创作效率提升有限
- 方案 B 最平衡，既不破坏现有模型，又能明显改善实际生产
- 方案 C 在用户体验上最直接，但容易过早固化语义

**当前建议：在 M2 仍按「纯通用 widget」推进（原方案 A）；M2 的第一批清单已由 M1 锁定为上述 8 项，等基础 widget 稳定后再重新评估是否引入 VN 模板/preset（原方案 B）。**

这与已冻结的预览与复用策略一致，也最符合“先把承载能力做扎实”的原则。

### 8.2 预览深度路线

可选方案：

- 方案 A：编辑器只做静态/布局预览，真实交互全部去 Dev Mode
- 方案 B：编辑器支持有限交互预览，Dev Mode 仍是主要真实调试入口
- 方案 C：编辑器尽量逼近真实运行时

评估：

- 方案 A 风险最低，也最符合当前蓝图文档对 Dev Mode 的定位
- 方案 B 体验更好，是较实际的中间路线
- 方案 C 成本高，而且很容易与 Dev Mode 形成双真相

**已确认选择：方案 A**

这是一个保守但一致的决定，优点是边界清晰，代价是编辑器内的交互反馈会更少。

### 8.3 Blueprint 入口集成位置

可选方案：

- 方案 A：只在属性面板中提供入口
- 方案 B：属性面板 + 画布工具栏 / 右键菜单双入口
- 方案 C：单独先做一个独立蓝图侧栏

评估：

- 方案 A 最小但跳转效率一般
- 方案 B 更适合作为长期方案
- 方案 C 更完整，但前期工作量大

**当前推荐：方案 B**

### 8.4 复用策略

可选方案：

- 方案 A：只依赖 Surface Link 与复制粘贴
- 方案 B：加入模板/预设
- 方案 C：直接做可嵌套的可复用组件系统

评估：

- 方案 A 太弱
- 方案 B 最适合当前阶段
- 方案 C 很强，但会迅速引入更复杂的生命周期与引用问题

**已确认选择：方案 A**

这个选择是合理的，因为它与当前主路线、静态预览策略都一致；但它也意味着复用效率会在一段时间内明显弱于模板或组件系统。

### 8.5 视觉小说相关能力的落地方式

可选方案：

- 方案 A：全部做成通用 widget 的组合示例
- 方案 B：通用 widget + 官方模板 + 官方 preset
- 方案 C：引入剧本对象、角色对象、镜头对象直接驱动画布

评估：

- 方案 A 太依赖人工拼装
- 方案 B 最符合当前方向
- 方案 C 已经偏向另一条产品路线

**当前建议：阶段一采用方案 A，并把常见界面沉淀成官方组合示例**

---

## 9. 推荐的阶段推进原则

### 9.1 先补承载能力，再补强语义体验

优先顺序建议始终是：

1. 通用 widget 能用
2. Blueprint 入口变真实
3. 预览与验证变可靠
4. 如果复用痛点持续放大，再重新评估模板/preset

### 9.2 不在编辑器内复制运行时

编辑器可以做更强的辅助预览，但不应该抢走 Dev Mode 作为真实调试入口的职责。

### 9.3 不过早把视觉小说语义写死进主模型

当前阶段应优先让高频模式以：

- 组合约定
- Surface Link
- 参考示例

形式沉淀，而不是引入新的主数据结构。

### 9.4 所有新增能力都要复用现有设计语言

编辑器内新增面板、属性行、入口按钮、校验提示与参考示例入口，都应该与当前 Workspace/Properties/UI Editor 的视觉风格保持一致。

---

## 10. M1 完成后的质量基线与缺口快照（冻结）

在 **Visual Editor M1** 结束时，应满足：

- 三份 `visual-editor` 文档对范围、预览边界、复用策略、M2 八件套 widget 清单一致。
- 工作区 UI 文案明确区分**编辑器布局预览**与 **Dev Mode 运行时预览**；左栏不暗示模板/组件库已存在。
- 属性面板 Blueprint 区域为**延期说明**，无误导性可点入口。

**仍属缺口、留给后续里程碑**（相对当前代码基线）：

- Blueprint **M4-full**：属性面板绑定编辑、Visual 画布侧图编辑等（M4-lite 已提供入口与摘要）。
- 编辑器内校验与资源缺失提示（M5）。
- 更强的复用入口（如组件库 / 模板）仅在产品重新决策后考虑；当前仍以 **App Surface link + 复制** 为准。

---

## 11. M2 实施接力锚点（文件族）

规划或实施 **M2（通用基础 widget 扩展）** 时，优先触及下列路径（与 M1 §0 / 里程碑 §4.5 一致）：

| 层级 | 路径 |
|------|------|
| 内置模块注册 | `src/renderer/lib/ui-editor/widget-modules/builtin/index.ts` |
| 单 widget 模块 | `src/renderer/lib/ui-editor/widget-modules/builtin/<widget>.tsx` 及子目录 `inspector.tsx`、`renderer.tsx` 等 |
| Widget 契约 | `src/renderer/lib/ui-editor/widget-modules/types.ts` |
| Element 类型 / 运行时映射 | `src/renderer/lib/ui-editor/element-types/builtin/index.ts`、`src/renderer/lib/ui-editor/runtime/builtin/index.ts` |
| 文档创建校验 | `src/renderer/lib/workspace/services/ui-editor/UIDocumentService.ts`（`createElement` 与类型表） |
| 画布插入菜单 | `src/renderer/apps/workspace/modules/ui-editor/editors/UISurfaceEditorTab.tsx`（右键 Insert 来自 registry） |
| 属性面板拼装 | `src/renderer/apps/workspace/modules/properties/PropertiesPanel.tsx` |
| 共享类型 | `src/shared/types/ui-editor/document.ts`（如未来扩展 props 约定） |

---

## 12. 面向后续实现的成功标准

当这一阶段完成时，理想状态应满足：

- 用户不再需要只靠矩形拼出大部分 UI
- 视觉小说高频界面可以通过基础控件与官方组合范式快速搭建
- 当前元素或 Surface 的 Blueprint 入口不再是占位
- 编辑器能明确告诉用户资源、布局、绑定上的主要问题
- 编辑器与 Dev Mode 的职责分层清晰，不互相打架

---

## 13. 仍待确认的关键决策

以下问题仍会影响 **M2 及以后** 的落地顺序（**第一批通用 widget 清单已在 M1 锁定**，不再属于本列表）：

- Blueprint 入口在 M4 第一阶段只做跳转，还是同时做最小事件绑定
- 文本类 widget 是否在 M2 就预留未来本地化结构位
- 是否在后续阶段重新引入模板/preset 体系

这些问题不阻止本文档成立，但会影响后续里程碑细化。

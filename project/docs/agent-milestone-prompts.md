# NarraLeaf Studio 交错里程碑 Prompts

## 使用方式

- 按本文档顺序逐条开启**全新对话**。
- 每个阶段分两条 prompt：
  - `Plan Prompt`：给 `GPT-5.4 Plan Mode`
  - `Implementation Prompt`：给 `Composer 2`
- 除非我明确确认，否则 agent **不能自行拍板技术选型**；一旦存在实现分歧、接口设计分歧、数据迁移分歧、UI 交互分歧，必须先通过编辑器提问。
- 下面的 prompt 已经基于当前推荐路径做了交错排序，不是简单照抄 `visual-editor-milestones.md` 和 `blueprint-system-milestones.md` 的原始顺序。

## 推荐执行顺序

1. `P1`：`Visual Editor M2-A` + `Blueprint M2`
2. `P2`：`Blueprint M3-min` + `Visual Editor M4-lite`
3. `P3`：`Visual Editor M2-B` + `Visual Editor M3`
4. `P4`：`Blueprint M4` + `Visual Editor M4-full`
5. `P5`：`Visual Editor M5` + `Blueprint M3-full`
6. `P6`：`Blueprint M5` + `Visual Editor M6`

## 通用增强模板

下面是这组 prompt 统一遵循的强化版模板；后面的每条具体 prompt 都已经内嵌了这套要求。

```md
完全理解 `@project/docs/...`（包含本任务所有必要文档，并自行补充读取 docs 内相关文件），使用子 agent 在项目中速览当前实现，然后输出一份完整的 `...系统 M.. 实现方案` / 或直接落地 `...系统 M..`（已完成前置阶段），要求精确到文件。

硬性要求：
- 先读文档，再用子 agent 速览实现，再归纳结论。
- 必须明确说明：哪些前置 milestone 已经视为完成，哪些不在本次范围内。
- 任何技术选型、接口设计、文件拆分、迁移策略、状态模型、UI 交互细节，只要存在两种以上合理方案，必须先通过编辑器工具询问我，不能自行假设。
- 方案与实现都要保持低耦合、高扩展性、清晰文件结构，并尽量复用现有模式。
- 规划时禁止直接开写实现；落地时禁止擅自扩大范围。
- 输出必须精确到文件级别：新增文件、修改文件、每个文件承担的职责、主要类型/接口/状态流、验收方式。
```

---

## P1-Plan

目标：先补 UI 承载面与 Blueprint 实例数据层底座。

```md
完全理解以下文件，并自行补充读取 docs 目录内的相关文件：

- `@project/docs/visual-editor-milestones.md`
- `@project/docs/blueprint-system-milestones.md`
- `@project/docs/visual-editor.md`
- `@project/docs/visual-editor-implementation-guide.md`
- `@project/docs/blueprint-system.md`
- `@project/docs/dev-mode.md`

使用子 agent 在项目中速览当前实现，然后编写一份完整的 `Visual Editor M2-A + Blueprint System M2 实现方案`。当前默认前置条件为：`Visual Editor M1` 与 `Blueprint System M1` 已经完成。

本阶段目标：
- `Visual Editor M2-A` 只实现第一批最核心 widget：`Text`、`Image`、`Button`、`Container/Frame`
- `Blueprint System M2` 做实：本地实例蓝图存储、owner 生命周期、`blueprintEvent` 事件绑定持久化、属性绑定持久化、与现有 UI 编辑器生命周期同步

规划输出要求：
- 先用子 agent 速览实现，给出当前代码基线判断
- 输出一份完整实现方案，保存到：
  - `project/docs/implementation-plans/p1-ve-m2a-bp-m2-plan.md`
- 方案必须精确到文件，并至少包含：
  - 范围与非目标
  - 当前实现现状与缺口
  - 总体实现策略
  - 数据模型与生命周期设计
  - widget 模块分层与新增文件清单
  - Blueprint M2 涉及的类型、服务、持久化、兼容与迁移策略
  - UI 入口/属性面板/插入菜单/Dev Mode 关联点
  - 详细到文件的修改计划
  - 风险点与回退策略
  - 验收标准与验证计划

硬性要求：
- 任何技术选型和细节实现问题都要先通过编辑器工具询问我
- 不要直接开始编码
- 方案要低耦合、高扩展性，并保持文件排列清晰
- 如果发现里程碑文档与当前实现存在冲突，要单独列出
```

## P1-Implement

```md
完全理解以下文件，并自行补充读取所有必要文件：

- `@project/docs/implementation-plans/p1-ve-m2a-bp-m2-plan.md`
- `@project/docs/visual-editor-milestones.md`
- `@project/docs/blueprint-system-milestones.md`
- `@project/docs/visual-editor.md`
- `@project/docs/visual-editor-implementation-guide.md`
- `@project/docs/blueprint-system.md`
- `@project/docs/dev-mode.md`

`Visual Editor M1` 与 `Blueprint System M1` 已完成。请严格按照 `p1-ve-m2a-bp-m2-plan.md` 落地 `Visual Editor M2-A + Blueprint System M2`。

本次实现范围仅限：
- 新增 widget：`Text`、`Image`、`Button`、`Container/Frame`
- 做实本地实例蓝图文档、owner 生命周期、`blueprintEvent` 与属性绑定持久化
- 接通本阶段必要的编辑器侧入口与生命周期同步

落地要求：
- 编码前先核对计划与当前代码是否仍一致
- 若出现技术分歧、类型设计分歧、命名分歧、迁移策略分歧，必须先问我
- 精确按文件实施，避免顺手加入 M3/M4 范围
- 完成后更新计划文档中的实施状态或新增简短实施记录
- 进行必要的针对性验证，并汇报：
  - 改了哪些关键文件
  - 哪些验收点已满足
  - 哪些问题留待下一阶段

质量要求：
- 低耦合、高扩展性
- 文件职责清晰
- 代码风格与现有项目一致
- 不写与当前任务无关的 Markdown 文档，除非只是更新已有计划文件或补充实施记录
```

---

## P2-Plan

目标：先打通最小 Blueprint 运行时闭环，同时把 Visual Editor 的 Blueprint 占位入口升级为真实但轻量的入口层。

```md
完全理解以下文件，并自行补充读取 docs 内相关文件：

- `@project/docs/visual-editor-milestones.md`
- `@project/docs/blueprint-system-milestones.md`
- `@project/docs/visual-editor.md`
- `@project/docs/visual-editor-implementation-guide.md`
- `@project/docs/blueprint-system.md`
- `@project/docs/dev-mode.md`
- `@project/docs/implementation-plans/p1-ve-m2a-bp-m2-plan.md`

使用子 agent 在项目中速览实现，然后编写一份完整的 `Blueprint System M3-min + Visual Editor M4-lite 实现方案`。当前默认前置条件为：`Visual Editor M1`、`Blueprint System M1`、`Visual Editor M2-A`、`Blueprint System M2` 已完成。

本阶段目标：
- `Blueprint System M3-min`
  - 先打通最小闭环：`Button click -> blueprint event -> 状态写入/读取 -> UI 可见变化 -> Dev Mode 基础调试事件`
  - 只做最小可用运行时，不追求完整节点族和完整 Host API
- `Visual Editor M4-lite`
  - Blueprint 区块从延期说明升级为真实入口层
  - 用户能看到当前 Surface / 元素是否挂了逻辑
  - 用户能从当前上下文跳到对应逻辑入口
  - 不要求完整 Visual Blueprint 编辑器

规划输出要求：
- 输出到：
  - `project/docs/implementation-plans/p2-bp-m3min-ve-m4lite-plan.md`
- 必须精确到文件，至少包括：
  - 最小运行时范围定义
  - 事件派发链与状态桥
  - Debug 事件最小集
  - `UIHostAdapter` / Dev Mode / Graph 或 Blueprint 执行链的演进方式
  - 属性面板 Blueprint 入口的轻量交互方案
  - 与后续完整 `Blueprint M4` 的兼容边界
  - 文件级实施计划与验收方案

硬性要求：
- 任何技术选型和细节实现问题都要先通过编辑器工具询问我
- 不直接编码
- 不得跳过“最小可用”直接设计重型编辑器
```

## P2-Implement

```md
完全理解以下文件，并自行补充读取必要文件：

- `@project/docs/implementation-plans/p2-bp-m3min-ve-m4lite-plan.md`
- `@project/docs/blueprint-system-milestones.md`
- `@project/docs/visual-editor-milestones.md`
- `@project/docs/blueprint-system.md`
- `@project/docs/visual-editor.md`
- `@project/docs/dev-mode.md`

当前默认前置条件为：`Visual Editor M1`、`Blueprint System M1`、`Visual Editor M2-A`、`Blueprint System M2` 已完成。请严格按计划落地 `Blueprint System M3-min + Visual Editor M4-lite`。

本次范围只做：
- 最小 Blueprint 事件执行闭环
- 最小状态桥 / 绑定求值 / Dev Mode 基础调试事件
- 属性面板中的真实 Blueprint 入口与状态可见性

落地要求：
- 若计划与代码不一致，先重新核对并问我
- 若遇到运行时结构选型、图执行兼容策略、入口 UI 交互分歧，先问我
- 不提前做完整 React Flow 蓝图编辑器
- 完成后更新计划文档状态，并给出精确到文件的实施总结与验证结果
```

---

## P3-Plan

目标：补齐剩余高频 widget，并沉淀常见 VN 界面的官方组合范式。

```md
完全理解以下文件，并自行补充读取 docs 内相关文件：

- `@project/docs/visual-editor-milestones.md`
- `@project/docs/visual-editor.md`
- `@project/docs/visual-editor-implementation-guide.md`
- `@project/docs/implementation-plans/p1-ve-m2a-bp-m2-plan.md`
- `@project/docs/implementation-plans/p2-bp-m3min-ve-m4lite-plan.md`

使用子 agent 在项目中速览实现，然后编写一份完整的 `Visual Editor M2-B + Visual Editor M3 实现方案`。当前默认前置条件为：`Visual Editor M1`、`Visual Editor M2-A`、`Blueprint System M2`、`Blueprint System M3-min`、`Visual Editor M4-lite` 已完成。

本阶段目标：
- `Visual Editor M2-B` 补齐：
  - `Stack`
  - `Scroll`
  - `Spacer/Divider`
  - `Option List / Repeater` 最小形态
- `Visual Editor M3`
  - 沉淀常见 VN 界面官方组合范式
  - 明确 Surface 命名、组织、Link 与复用约定

规划输出要求：
- 输出到：
  - `project/docs/implementation-plans/p3-ve-m2b-ve-m3-plan.md`
- 方案必须精确到文件，并至少包含：
  - 剩余 widget 的最小能力边界
  - 组合范式如何落地：文档、示例、内置入口、还是轻量样板
  - 不引入模板系统前提下的复用策略
  - 文件级实施清单
  - 验收标准与 UI 一致性要求

硬性要求：
- 任何技术选型和细节实现问题都要先通过编辑器工具询问我
- 不直接编码
- 必须保证界面风格与项目其他部分一致
```

## P3-Implement

```md
完全理解以下文件，并自行补充读取必要文件：

- `@project/docs/implementation-plans/p3-ve-m2b-ve-m3-plan.md`
- `@project/docs/visual-editor-milestones.md`
- `@project/docs/visual-editor.md`
- `@project/docs/visual-editor-implementation-guide.md`

当前默认前置条件为：`Visual Editor M1`、`Visual Editor M2-A`、`Blueprint System M2`、`Blueprint System M3-min`、`Visual Editor M4-lite` 已完成。请严格按计划落地 `Visual Editor M2-B + Visual Editor M3`。

本次范围只做：
- `Stack`、`Scroll`、`Spacer/Divider`、`Option List / Repeater`
- 常见 VN 组合范式与 Surface 复用约定的实际承载

落地要求：
- 若涉及 UI 交互、组件粒度、默认样式、范式承载方式等分歧，先问我
- 不引入模板/preset 系统，除非我明确确认
- 保持文件组织清晰、扩展方式统一
- 完成后更新计划文档状态，并汇报验收完成度
```

---

## P4-Plan

目标：做完整 Visual Blueprint 编辑器，并把 Visual Editor 的 Blueprint 入口升级为完整工作流。

```md
完全理解以下文件，并自行补充读取 docs 内相关文件：

- `@project/docs/blueprint-system-milestones.md`
- `@project/docs/visual-editor-milestones.md`
- `@project/docs/blueprint-system.md`
- `@project/docs/visual-editor.md`
- `@project/docs/dev-mode.md`
- `@project/docs/implementation-plans/p2-bp-m3min-ve-m4lite-plan.md`

使用子 agent 在项目中速览实现，然后编写一份完整的 `Blueprint System M4 + Visual Editor M4-full 实现方案`。当前默认前置条件为：`Blueprint System M3-min` 与 `Visual Editor M4-lite` 已完成，且 `Visual Editor M2` 基础 widget 已完整可用。

本阶段目标：
- `Blueprint System M4`
  - 独立蓝图编辑 Tab
  - Visual Blueprint 编辑器
  - 成员树、节点检查器、图级校验
- `Visual Editor M4-full`
  - 从 Surface / 元素 / 属性完整跳转蓝图
  - `Literal / Bound / Broken` 等绑定状态
  - 从属性绑定跳到声明成员

规划输出要求：
- 输出到：
  - `project/docs/implementation-plans/p4-bp-m4-ve-m4full-plan.md`
- 必须精确到文件，至少包括：
  - 编辑器架构分层
  - React Flow 或其他图编辑基础设施的接入点
  - 节点注册 UI 元信息设计
  - 属性面板与蓝图编辑器之间的导航关系
  - 校验系统与错误展示
  - 文件级实施清单、风险与验收标准

硬性要求：
- 任何技术选型和细节实现问题都要先通过编辑器工具询问我
- 不直接编码
- 不得把运行时语义塞进纯 UI 画布层
```

## P4-Implement

```md
完全理解以下文件，并自行补充读取必要文件：

- `@project/docs/implementation-plans/p4-bp-m4-ve-m4full-plan.md`
- `@project/docs/blueprint-system-milestones.md`
- `@project/docs/visual-editor-milestones.md`
- `@project/docs/blueprint-system.md`
- `@project/docs/visual-editor.md`

当前默认前置条件为：`Blueprint System M3-min`、`Visual Editor M4-lite`、`Visual Editor M2` 已完成。请严格按计划落地 `Blueprint System M4 + Visual Editor M4-full`。

本次范围只做：
- 蓝图编辑 Tab 与 Visual Blueprint 编辑器
- 成员树、节点检查器、图校验
- Visual Editor 到 Blueprint 的完整跳转与绑定状态展示

落地要求：
- 任何编辑器框架选型、节点 UI 元信息设计、导航流设计、绑定状态机设计分歧，先问我
- 不得越权实现 M5 的 TypeScript Blueprint
- 完成后更新计划文档状态，并给出文件级总结和验证结果
```

---

## P5-Plan

目标：增强创作反馈与调试反馈，把“能用”提升为“更容易发现问题”。

```md
完全理解以下文件，并自行补充读取 docs 内相关文件：

- `@project/docs/visual-editor-milestones.md`
- `@project/docs/blueprint-system-milestones.md`
- `@project/docs/visual-editor.md`
- `@project/docs/blueprint-system.md`
- `@project/docs/dev-mode.md`
- `@project/docs/implementation-plans/p4-bp-m4-ve-m4full-plan.md`

使用子 agent 在项目中速览实现，然后编写一份完整的 `Visual Editor M5 + Blueprint System M3-full 实现方案`。当前默认前置条件为：`Blueprint System M4` 与 `Visual Editor M4-full` 已完成。

本阶段目标：
- `Visual Editor M5`
  - 缺失资源提示
  - link 异常提示
  - Surface / Stage 配置异常提示
  - 越界、可见性、热点尺寸等静态创作反馈
- `Blueprint System M3-full`
  - 在既有最小运行时闭环基础上补齐更多节点族、Host API、调试桥和错误定位

规划输出要求：
- 输出到：
  - `project/docs/implementation-plans/p5-ve-m5-bp-m3full-plan.md`
- 必须精确到文件，至少包括：
  - 静态验证层与运行时调试层的职责边界
  - 诊断数据来源与展示位置
  - Host API 扩展计划
  - 节点族扩展策略
  - 文件级实施计划与验收标准

硬性要求：
- 任何技术选型和细节实现问题都要先通过编辑器工具询问我
- 不直接编码
- 不要把 Visual Editor 变成第二个 Dev Mode
```

## P5-Implement

```md
完全理解以下文件，并自行补充读取必要文件：

- `@project/docs/implementation-plans/p5-ve-m5-bp-m3full-plan.md`
- `@project/docs/visual-editor-milestones.md`
- `@project/docs/blueprint-system-milestones.md`
- `@project/docs/visual-editor.md`
- `@project/docs/blueprint-system.md`
- `@project/docs/dev-mode.md`

当前默认前置条件为：`Blueprint System M4` 与 `Visual Editor M4-full` 已完成。请严格按计划落地 `Visual Editor M5 + Blueprint System M3-full`。

本次范围只做：
- 静态创作反馈与诊断
- Blueprint 运行时能力与调试能力补完

落地要求：
- 若涉及诊断来源、提示优先级、Host API 设计、节点扩展顺序等分歧，先问我
- 保持编辑器静态预览与 Dev Mode 真实执行的边界清晰
- 完成后更新计划文档状态，并汇报文件级结果与验证结论
```

---

## P6-Plan

目标：最后补齐 TypeScript Blueprint、共享蓝图资产与生产级收口。

```md
完全理解以下文件，并自行补充读取 docs 内相关文件：

- `@project/docs/blueprint-system-milestones.md`
- `@project/docs/visual-editor-milestones.md`
- `@project/docs/blueprint-system.md`
- `@project/docs/visual-editor.md`
- `@project/docs/dev-mode.md`
- `@project/docs/implementation-plans/p5-ve-m5-bp-m3full-plan.md`

使用子 agent 在项目中速览实现，然后编写一份完整的 `Blueprint System M5 + Visual Editor M6 实现方案`。当前默认前置条件为：`Blueprint System M4`、`Blueprint System M3-full`、`Visual Editor M5` 已完成。

本阶段目标：
- `Blueprint System M5`
  - TypeScript Blueprint 编辑器
  - TS 编译与装载链
  - 共享蓝图资产
  - DevTools 强化
- `Visual Editor M6`
  - 生产级收口
  - 插入/搜索/复制复用入口优化
  - 更一致的属性面板体验
  - 更明确的错误与空状态文案
  - 团队级最佳实践沉淀

规划输出要求：
- 输出到：
  - `project/docs/implementation-plans/p6-bp-m5-ve-m6-plan.md`
- 必须精确到文件，至少包括：
  - TS Blueprint 编辑器与编译装载链设计
  - 共享蓝图资产接入点
  - DevTools 强化方案
  - Visual Editor 生产级收口清单
  - 文件级实施计划、风险与验收标准

硬性要求：
- 任何技术选型和细节实现问题都要先通过编辑器工具询问我
- 不直接编码
- 必须保持高扩展性，避免为 TS Blueprint 引入难以维护的特殊分支
```

## P6-Implement

```md
完全理解以下文件，并自行补充读取必要文件：

- `@project/docs/implementation-plans/p6-bp-m5-ve-m6-plan.md`
- `@project/docs/blueprint-system-milestones.md`
- `@project/docs/visual-editor-milestones.md`
- `@project/docs/blueprint-system.md`
- `@project/docs/visual-editor.md`
- `@project/docs/dev-mode.md`

当前默认前置条件为：`Blueprint System M4`、`Blueprint System M3-full`、`Visual Editor M5` 已完成。请严格按计划落地 `Blueprint System M5 + Visual Editor M6`。

本次范围只做：
- TypeScript Blueprint
- 共享蓝图资产
- DevTools 强化
- Visual Editor 生产级收口

落地要求：
- 若涉及 TS Blueprint 语义边界、编译链方案、资产模型、DevTools 呈现、UI 收口策略等分歧，先问我
- 不扩大到文档外的新系统
- 完成后更新计划文档状态，并给出文件级实施总结、验证结果与剩余风险
```

---

## 最后建议

- 如果你想降低单次实施复杂度，`P4` 之后可以进一步拆成更细的小阶段。
- 如果你更重视尽快可用，优先保证 `P1 -> P2 -> P3` 连续完成；这三步完成后，系统就会从“骨架 + 契约”进入“能做界面 + 能挂最小逻辑 + 有基础范式”的状态。
- 如果某一阶段计划产出里发现前置阶段并未真正完成，不要硬上实现，先补文档和验收缺口。

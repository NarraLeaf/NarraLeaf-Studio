# NarraLeaf Studio — Visual Editor（架构、指南与里程碑合并稿）

本文档合并自原 `visual-editor-implementation-guide.md`、`visual-editor-milestones.md`，以及 `implementation-plans` 中界面编辑器相关实施记录。蓝图契约、运行时与 M1–M5 蓝图里程碑见 **`project/docs/blueprint-system-arch.md`**。代码级速览见 **`project/docs/visual-editor.md`**。

---

## 1. 文档目标

- 明确 Visual Editor **承担与不承担**的边界。
- 基于仓库真实状态梳理缺口、占位与优先方向。
- 为实现提供稳定产品边界、技术选项与阶段目标。

**不在本文展开：** Blueprint Runtime 全链细节、TS 蓝图实现细节、共享资产系统细节、剧情运行时 —— 但保留与蓝图的 **入口与对接边界**；执行真相以 **Dev Mode** 为准（见 `blueprint-system-arch.md`）。

---

## 2. 适用范围与 M1 冻结结论

| 决策项 | 冻结结论 |
|--------|----------|
| 范围 | 仅 Visual Editor；Blueprint System M1 契约见 `blueprint-system-arch.md`，此处不重开。 |
| M1 交付 | **冻结与基线**：文档对齐、质量基线、占位/文案与静态预览边界；**不**在 M1 交付新 widget、Blueprint 真入口或模板系统（后续里程碑已推进部分能力）。 |
| 预览 | **方案 A**：编辑器内仅**静态/布局**预览；真实交互与副作用 **Dev Mode**。 |
| 复用 | **方案 A**：仅 **Surface Link + 复制粘贴**；不引入模板/preset/组件系统（除非产品另立项）。 |
| M2 八件套 | **已锁定**：Text、Image、Button、Container/Frame、Stack、Scroll、Spacer/Divider、Option List/Repeater 最小形态。 |
| 控件路线 | 以**纯通用 widget** 为主，与上表一致。 |

---

## 3. 当前状态判断

### 3.1 已具备基础

- `Surface` 组织（App / Stage）；Stage → App **link**。
- `UIDocument`、`UIGraphDocument` 独立持久化与自动保存。
- 画布：渲染、选择、框选、拖拽、缩放、裁剪等。
- **Widget Module** 扩展模型；属性面板、Scene 属性、Surface 管理、Dev Mode 启动入口。

### 3.2 关键缺口与演进方向（对照里程碑）

- **M2 八件套已齐**（M2-A + M2-B）；不应再以“仅矩形”为基线叙述。
- **Blueprint：** M4-lite **done**；M4-full **partial**（Tab 内 React Flow、绑定三态、搜索/创建声明、诊断聚焦；画布**不**默认接完整 `blueprintRuntime`）。
- **Surface 编辑 Tab** 内 `hostAdapter.effects.runEffect` 仍可为最小/no-op — **符合**“编辑器不复制运行时”边界。
- **范式：** `project/examples/visual-editor/` + `visual-editor.md` §4.4；**无**编辑器内模板库。
- **M5 静态诊断：** `collectSurfaceDiagnostics` 聚合；部分规则 **partial**（见 §8.2）。
- **M6：** 插入/搜索弹层、剪贴板 `blueprintCopyRemap` UI、Monaco 级 TS 等可能仍为 **P6 残余**。

### 3.3 投入优先级结论

在 M2/M3 基线之上，更值得投入：**预览/验证/Link 健康（M5）**、**Blueprint 深度编辑与 Dev Mode 闭环（M4-full）**、在**无模板系统**前提下维护示例与文档一致。

---

## 4. 已确认主路线

- **A：** 继续以**通用 UI Editor** 为核心。
- 编辑器预览只做静态/布局；**Dev Mode** 为真实运行时。
- 复用：**Surface Link + 复制粘贴**。

**代价：** 编辑器不内置“剧情段落/镜头”等领域对象；VN 体验靠 widget + 组合约定 + validation + preview；强复用需待产品重评模板/组件。

---

## 5. 视觉小说创作下的优先级元素

1. **通用基础控件**（§2 八件套）。  
2. **高频界面范式**（Dialog、Choice、Toast、Settings、Save/Load、Pause/Overlay 等）— 官方组合，**非**模板引擎。  
3. **视觉槽位**（背景、立绘、铭牌、对白体、选择行、HUD）— 用通用 widget + 命名约定。  
4. **资产联动**：选图、替换、预览、缺失提示、用途区分。  
5. **预览与验证**：越界、缺资源、Stage/layer、可点击区域、绑定入口可见、Dev Mode 跳转。

**Option list：** 用 `ListRepeater` + 行模板（Button + Text），不强制独立 OptionList 主控件。

---

## 6. 能力分层

| 层 | 内容 |
|----|------|
| Core Editor | 文档模型、Widget 扩展、画布交互、对齐/分布/复制/层级 |
| VN Production | 范式、Surface 约定、资产工作流、校验规则 |
| Blueprint Integration | 入口、事件/绑定状态、跳转上下文 — **执行在 Dev Mode** |

---

## 7. 关键技术选项（当前评估）

| 主题 | 选择 |
|------|------|
| 控件扩展 | 阶段一纯通用 widget（原方案 A）；八件套锁定 |
| 预览深度 | **方案 A**（静态 only） |
| Blueprint 入口位置 | **推荐方案 B**：属性面板 + 工具栏/右键（长期） |
| 复用 | **方案 A**（Link + 复制） |
| VN 能力落地 | **方案 A→示例**：组合 + 官方范式，非强语义 widget |

---

## 8. 里程碑 M1 — M6（Editor Only）

与 `blueprint-system-arch.md` 分工：**蓝图 M1–M5** 不在此重复；此处为**编辑器侧** M1–M6。

### 8.1 M1 — 方向冻结与体验基线

**必须：** 锁定通用 UI 核心路线；非目标；盘点占位与偏差；锁定 M2 八件套；冻结静态预览与无模板；与 Blueprint 文档分工明确。

**产物：** 本文 + `visual-editor.md` §0 一致；团队能区分编辑器工作 vs 运行时工作。

**验收锚点：** `UISurfacesPanel.tsx`、`UISurfaceEditorTab.tsx`、`PropertiesPanel.tsx`、`builtin/index.ts`；Blueprint 区 M1 可为延期说明，**M4-lite 起**为真入口。

### 8.2 M2 — 通用基础 Widget

**M2-A（与 BP M2 同期）：** `nl.text`、`nl.image`、`nl.button`、`nl.container`。  
**M2-B：** `nl.stack`、`nl.scroll`、`nl.spacerDivider`、`nl.listRepeater` + 流式子布局规则（见 `visual-editor.md` §4.2）。

**原则：** 每 widget 有 `createDefaultElement`、runtime render、inspector；注册与 `UIDocumentService` 一致。

**非目标：** 大量 VN 强语义控件、完整蓝图编辑器、高级继承。

**文件族：** `widget-modules/builtin/*`、`types.ts`、`element-types/builtin`、`runtime/builtin`、`UIDocumentService.ts`、`UISurfaceEditorTab.tsx`、`PropertiesPanel.tsx`、`document.ts`。

### 8.3 M3 — Surface 复用约定与组合范式

**交付：** 官方参考结构（Dialog、Choice、Toast、Settings、Save/Load、Overlay/Pause）+ App Surface link 约定。

**路径：** `project/examples/visual-editor/*/editor/ui/uidoc.json`；说明表 **`visual-editor.md` §4.4**。

**风险：** 无模板系统则效率提升有限；需范式文档防随意拼装。

### 8.4 M4 — Blueprint 入口与编辑器内可见性

**目标：** placeholder → 真实入口层；逻辑状态可见；可识别事件/绑定；上下文跳转。

**M4-lite（done）：** 只读摘要 + Open blueprint entry → 轻量 Tab；执行在 Dev Mode（BP M3-min）。

**M4-full（partial）：** Literal/Bound/Broken；解绑、跳转声明；**搜索/创建声明并绑定**（P7 去掉 `prompt`）；`blueprint-lite` 内 Visual 编辑与诊断跳转。

**不默认验收：** 画布挂完整 `blueprintRuntime`（边界：真实执行在 Dev Mode）。差额叙述已收入 `blueprint-system-arch.md` §16.4。

### 8.5 M5 — 验证、静态预览、创作反馈

**目标：** 从“能画”到“能发现问题”。

**规则状态表（对照 `diagnostics/rules`）：**

| 交付项 | 典型状态 |
|--------|----------|
| 缺失资源 | done（`resourceDiagnostics`） |
| link 异常 | done（`linkDiagnostics`） |
| Stage/Surface 配置 | partial（`stageDiagnostics`） |
| 元素越界 | done（`layoutDiagnostics`） |
| 可见性陷阱 | partial（`interactionDiagnostics`） |
| 热点与尺寸 | done（`interactionDiagnostics`） |
| Dev Mode 入口 | done（`UISurfaceEditorTab` 等） |

聚合：`collectSurfaceDiagnostics.ts`；属性面板条带可带 **`elementId` 跳转选中画布元素**（P7）。

**原则：** 静态在 Workspace；运行时轨迹在 Dev Mode。

### 8.6 M6 — 生产级收口与团队复用

**目标：** 稳定范式与示例、插入/搜索/复制顺手、属性面板一致、错误/空状态文案、最佳实践写入 `visual-editor.md` 等。

**Partial：** 统一 InsertSearchPopover、剪贴板 remap UI、Monaco 级 TS 等 — 见 `blueprint-system-arch.md` §16.6 残余。

### 8.7 推荐顺序

M1 → M2 → M3 → M4 → M5 → M6。**勿倒置**先做重蓝图入口而承载控件不足。

### 8.8 开放决策门

- M4 首阶段是否仅跳转或同时最小事件绑定（已部分超越）。  
- 文本 widget 是否在 M2 预留 i18n 结构位。  
- 未来是否重新引入模板/preset/组件系统。

---

## 9. 阶段推进原则

1. 先补承载能力，再补语义体验。  
2. 不在编辑器内复制 Dev Mode。  
3. 不过早把 VN 语义写死进主模型。  
4. 新增 UI 与 Workspace/Properties 设计语言一致。

---

## 10. M1 质量基线与缺口快照

M1 结束时：三份文档（`visual-editor.md` §0、本文 §2/§8.1、原实现指南 §2.1）对边界、预览、复用、八件套一致；文案区分**编辑器静态预览**与 **Dev Mode 运行时**。

**相对快照演进：** Blueprint 区已过 M4-lite；M4-full partial；M5 部分落地（见 §8.5）。

**仍指向后续：** M4-full 剩余、M5 规则扩展、M6/P6 插入搜索与 remap — 详见 `blueprint-system-arch.md` §16。

---

## 11. 成功标准（阶段完成时）

- 不必只靠矩形拼 UI。  
- 高频 VN 界面可用基础控件 + 范式搭建。  
- Blueprint 入口非空洞占位（按里程碑分层）。  
- 资源/布局/绑定主要问题可被提示。  
- 编辑器与 Dev Mode 职责清晰。

---

## 12. 与原 implementation-plans 的对应（仅索引）

| Phase | Visual Editor 要点 |
|-------|---------------------|
| P1 | M2-A 四件套 + BP M2 同期 |
| P2 | M4-lite 入口 |
| P3 | M2-B + 六组示例目录 |
| P4 | M4-full 已做/partial 表 |
| P5 | M5 诊断 + BP M3-full 交叉 |
| P6 | M6 收口与残余风险 |
| P7 | 文档对齐、声明绑定 UI、诊断跳转 |

全文级 P1–P7 叙述与 BP 侧矩阵见 **`blueprint-system-arch.md` §15–§16**。

---

## 13. 相关代码锚点（补充）

| 用途 | 路径 |
|------|------|
| 静态诊断 | `src/renderer/lib/ui-editor/diagnostics/*` |
| 编辑器 Host 工厂（可选接线） | `editorHostAdapter.ts` |
| Button 蓝图派发 | `nl.button` renderer（需 `blueprintRuntime` 时才派发） |

---

*End of visual-editor-arch.md*

---
title: "task: M7 演出透镜 — parallel/race 容器的条形时间视图"
type: handoff
status: draft
date: 2026-07-24
parent: 2026-07-22-001-feat-story-editor-overhaul.md
---

# task: M7 演出透镜

你是执行者。前置阅读：总计划 `2026-07-22-001` §4.4 与 §10（**`Control.any` 败者不掐断已裁决维持**——透镜的呈现不得暗示"胜出即中止"，若 UX 上确需该语义，停机报告而不是改引擎）；`docs/plans/reports/2026-07-23-M4-engine-report.md` WI-1（All/Any 硬化结论——透镜的准入条件已满足）；M3 卡 §0/§1 纪律铁律原样适用。分支：从 develop（`ebb4025`）切 `feat/story-m7-staging-lens`。报告：`docs/plans/reports/2026-07-24-m7-report.md`（≤60 行同模板）。

**并行提示**：另一执行者在引擎仓做 0.16.1 小卡，零交集。本卡**不碰引擎、不碰 transitions 词表**（0.16.1 采纳是后续微卡）。

## 现状地图

- 文档模型：`StoryControlPayload`（document.ts，sequence/parallel/race/repeat），编译到 `Control.do/all/allAsync/any`；`/parallel` `/race` `/sequence` 指令与容器行渲染（深度缩进、条件容器的 header chip 先例）都已在。
- 行渲染：`StorySceneEditorRows.tsx`（容器行 + 子行按 depth 缩进）；`blockOverview`（M3）供每行的目标+op 概览片段；quickParams（M2）的 `d=` token。
- 时长来源：子块 payload 的 `durationMs`/`transition.props.d`/wait 时长——不完整是常态（无时长的动作按未知处理）。

## 工作项

- **WI-1 透镜渲染（核心）**：parallel/race 容器的**替代渲染**——容器 header 加 hover-reveal 切换（列表 ⇄ 透镜，状态随会话持久化沿 M1 密度的存法）；透镜内每个直接子块一条横向轨：左侧=该子块的 blockOverview 片段（徽标+目标+op），右侧=时长条（有 `d=`/duration 的按比例、未知时长的画成等宽虚条；delay 类（wait 前缀）画成偏移）。**race 容器**在视觉上标出"先完成者胜"语义（细部自定，克制——不加图例文字）。嵌套容器在透镜内渲染为一条"子组"轨（点击进入=展开为它自己的透镜或跳到该行，自定）。纯投影、零新文档字段。
- **WI-2 行语义保持**：透镜内每条轨仍是"行"：点击=选中子行+右栏检查器联动、右键菜单可用、`d=` token 原位快编、拖拽重排子块顺序（复用 dnd 既有机械——若透镜内拖拽成本超预估，降级为仅支持"上移/下移"菜单项并报告）。行号、Enter/Escape、播放头高亮（M5 的 selectRow 通道）照常。
- **WI-3 编辑便利**：透镜尾部一个"+"槽（复用 InsertRow 机制限定在容器内插入）；容器 header 显示模式徽标（all/allAsync/any 对应 parallel/parallel-async/race——用既有类别色语言）。

## 明确不做

改引擎语义（any 掐断）；关键帧/曲线时间轴（远期 v2，Story Motion 并轨另立项）；新文档字段；变更 /parallel /race 的编译产物。

## 验证与停机

lint/vitest 新失败 0 + 透镜投影单测（时长/延迟/未知条的推导）；真机：构造一个 3-4 元素并行演出（移动+淡入+BGM+等待），透镜渲染正确、点轨选行、快编时长、Dev Mode 播放与透镜预期一致（截图）；用户手测欠账照旧累积。停机：透镜与行语义（选择/拖拽/播放头）冲突到需要改交互契约；dnd 在透镜内的成本触发降级仍不够。

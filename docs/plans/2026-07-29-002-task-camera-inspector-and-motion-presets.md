---
title: "task: /camera 属性编辑器重设计 + Story Motion 预设动画库"
type: task
status: done
date: 2026-07-29
parent: 2026-07-24-006-plan-story-action-model-alignment.md
---

# task: 镜头编辑器与预设动画

分支 `feat/story-camera-motion`（worktree `D:/Temp/nls-camera`，off develop `7c77eafd`）。
前置：A2 报告 `reports/2026-07-25-a2-camera-report.md`（`/camera` 的既有落点与钳制约定）。

用户诉求两条：
1. `/camera` 的属性编辑器**设计水准不如 `/transform`**——`/transform` 有 preset/motion 双模、
   有 Story Motion 绑定与悬停实时预览；`/camera` 只有一个下拉 + 一个裸数字框。
   镜头**也应该能应用 Story Motion（Transform）**。
2. 给 Story Motion 系统做**一套预设动画**（摇晃、震动这类常见 VN 动画）。

## 事实核实（动工前已验证，不是假设）

| 事实 | 位置 | 结论 |
|---|---|---|
| 引擎 `Camera extends Displayable`，有 `.transform(new Transform(...))` | `narraleaf-react/dist/.../elements/camera.d.ts` | 镜头能吃 Transform，**无需改引擎** |
| 动画 ref → Transform 的构造已存在 | `storyCompiler.ts:createAnimationTransform` | 复用，不新建机械 |
| 动画"落定姿态"求解已存在且快照能拿到 assets | `storyTransformProps.ts:storyTransformRefFinalProps`、`storyStageSnapshot.ts:finalProps` | 行级起播能预置镜头动画的终态，**A2 报告 §5 的保真缺口不会在新 op 上复现** |
| `normalizeAnimationTargetKind` 把未知 kind **静默改写成 `image`** | `storyModel.ts:1054` | 加 `"camera"` 是硬要求，漏了就静默丢资产归属 |
| `Transform` 的 `repeat?: number`（有限） | `transform/type.d.ts:18` | 循环类预设只能给有限次数，**不做无限循环**（transform 动作是被等待的，无限循环会挂住剧情） |
| 既有"模板"只有 4 个，且入口是"新建"按钮旁一个窄下拉 | `storyMotionTimeline.ts:31`、三处调用 | 预设库取代它 |
| `StoryMotionPicker.tsx` 无任何外部调用方 | 全仓 grep | 休眠代码，只做机械对齐，不投设计 |

## D1 镜头吃 Story Motion：新增第六个 operation

`action:"camera"` 的 `operation` 加 `"motion"`，payload 加 `motion?: StoryTransformRef`。
**加性，不 bump schema**（沿用 A2 的先例）。

- 编译：`camera.transform(createAnimationTransform(ref, ctx, blockId, "none"))`。
  只认 `mode:"animation"`；缺 id / 找不到资产由 `createAnimationTransform` 自己出诊断。
- 快照：`camera.props = merge(props, finalProps(payload.motion, "none", blockId))`，
  即镜头动画的终态参与行级起播的预置姿态（见上表第 3 行）。
- 演出透镜：`motion` op 返回 **undefined（未知时长）**——真时长在资产里，
  `deriveBlockTiming` 是纯函数读不到它。写死 payload 里那个 600ms 的默认值会画出错误的条。
- spec：`/camera motion` 可补全；`motion` 落块后开检查器（`inspectorAfterCommit` 是静态 flag，
  `/camera` 整体开启的副作用是别的 op 也会开——**不接受**，故改为让 spec 支持
  `inspectorAfterCommit` 取函数（按已解析参数决定），`/fx` `/transform` 的静态 true 行为不变）。

## D2 动画资产的 target kind 扩到镜头

`StoryMotionTargetKind = StoryDisplayableTargetKind | "camera"`，只用于**动画资产**
（`StoryAnimationAsset.targetKind`、`StoryAnimationIndexEntry.targetKind`、预览目标）。
**不动** `StoryDisplayableTargetKind` 本身——那个类型是 `targetParam(accepts)` 与侧栏分类的输入，
拓宽它等于让 `/transform` 把镜头列成候选目标，而 `/camera motion` 才是镜头的入口。

镜头动作的预览：镜头变换的是**整个舞台**，所以预览帧＝舞台矩形（不是立绘框），
内容是 `previewAssetId` 的图或一个占位舞台。位置语义**不做反向**：
引擎的 `camera.pan` 就是 `Displayable.pos` 的别名，编译器与快照都把 position 直接预置到 camera 上，
预览按"镜头就是一个 displayable"渲染才与运行时一致。

## D3 `/camera` 编辑器重设计

搬出 `StorySceneActionInspector.tsx`（已 2653 行）到同级 `CameraActionEditor.tsx`。

- **操作选择器**：6 个带图标的分段按钮（Zoom / Pan / Rotate / Darken / Motion / Reset），
  取代下拉。镜头是一件乐器、六个旋钮，下拉把它讲成了"六件无关的事"。
- **取景器（本卡的设计核心）**：一个舞台比例的框，把**当前 op 那一路**的姿态画出来——
  缩放改框的大小、旋转转框、压暗压框的亮度、pan 移框。`pan` 时框**可拖拽**，其余 op 只读。
  只画当前 op 的通道，因为编译期只读那一路（`reset` 画中性、`motion` 不画，
  motion 有 `MotionField` 自己的悬停预览）。
  这是"0.3 / 0.5 两个数字"与"看得见的一个取景框"之间的差别，也是 `/transform` 领先的那一截。
- **滑杆 + 数字**：zoom 0.25–4、rotate −180–180、darken 0–1，各自带滑杆（`Slider` 已存在）
  与数字框；钳制照 A2 的约定留在 `onChange`（检查器不许存下编译期会改写的值）。
  `pan` 额外给 left/center/right 三枚快捷片，与命令行的 placement 同源。
- `motion` 模式下隐藏时长/缓动（真时长在资产里，留着就是两个死字段）。

## D4 预设动画库

新文件 `storyMotionPresets.ts`：`STORY_MOTION_PRESETS`，每条 `{ id, category, targetKinds, build(), config? }`。
分类：入场 / 退场 / 强调 / 待机 / 反应 / 镜头。
覆盖 VN 常见项：淡入滑入、居中弹出、滑入左右、坠入、旋转登场；淡出滑出、缩小消失；
闪白、脉冲、心跳、跳跃、变焦冲击；呼吸、漂浮、轻摇（有限循环）；
**摇晃、震动**、点头、摇头、后仰、眩晕、倒下；
镜头：镜头震动、冲击、推近、拉远、横摇、荷兰角、变焦冲击、缓慢漂移。

旧的 `STORY_MOTION_TEMPLATES`（4 条）与 `motion.templates.*` i18n **删除**，
四条原模板作为预设保留（`fadeInSlide` / `centerPop` / `lookAround` / `flash`），三处调用点迁移。

## D5 预设库 UI

`MotionSelector` popover 加分段 `[项目 | 预设]`：
- 项目页＝现有资产列表（原样，含悬停实时预览）。
- 预设页＝按分类分组的卡片；**悬停时该卡自己动**（一次只动一张，不是 24 个 rAF）；
  点击＝按预设创建资产并绑定（作者随后可以自由改——预设是种子，不是不可变引用）。
- 悬停预览的采样/渲染管线从 `MotionHoverPreview` 抽出，资产与预设共用一份。
- `StoryMotionPanel` 的新建菜单同样列预设（按分类）。

## 明确不做

- 不改引擎。
- 不做无限循环预设（会挂剧情，见上表第 5 行）。
- 不把 `"camera"` 塞进 `StoryDisplayableTargetKind`（见 D2）。
- 不给休眠的 `StoryMotionPicker.tsx` 投设计。
- 不做"镜头预设直接当 op 值"（`/camera shake` 那种免建资产的写法）——那要编译期解析
  builtin id、picker 合并两个来源、编辑器处理只读资产，三处新机械换一点点手感，不值。

## 验收

- 四个 tsc project 全绿（worktree 里 `yarn lint` 走不通，直接跑 `npx tsc -p ...`）。
- vitest 对齐 win32 基线（9 条既有失败），新失败 0。
- 新增测试：镜头 motion 的编译产物形状、快照终态、透镜未知时长、
  `normalizeAnimationTargetKind` 认 camera、预设库结构（每条都能造出非空时间线、
  时长有界、循环类必须有 `config.repeat`）、i18n 键齐备（en/zh 平价测试已在）。
- **真机**：orchestrator 亲眼看（用户铁令），不以子代理报告/测试绿代替。

---

**收尾**：全部完成，报告 `reports/2026-07-29-camera-inspector-and-motion-presets-report.md`。
计划里没有预见、实施时补上的三件：画廊停帧启发式（否则 24 个一样的方块）、占位主体改按舞台比例
（既有缺陷，是空方块的真凶）、行摘要的 `motionName` 查表（否则一屏 `/camera motion` 行都只写 "Motion"）。

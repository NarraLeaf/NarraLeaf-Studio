---
title: "report: A2 —— /camera 指令、payload、编译与检查器"
type: report
status: done
date: 2026-07-25
parent: 2026-07-24-008-task-a2-camera.md
---

# A2 `/camera` 报告（WI-1..5）

分支 `feat/story-a2-camera`（off develop `a93c0d0`），2 个 commit（`01cb228` payload/spec/编译，`5ab2047` 检查器/行摘要/透镜）。未合并、未 push。

| WI | 内容 | 状态 |
|---|---|---|
| WI-1 | `action:"camera"` payload（加性，**未 bump** schema，仍 v9）+ `nlrStory.camera.<op>` 编译 + 钳制 | done |
| WI-2 | `/camera` spec（别名 `/cam`），operation 为核心首位参 | done |
| WI-3 | 检查器区：operation 切换 + 对应参数 + 时长/缓动 | done |
| WI-4 | `deriveBlockTiming` 认识 camera `durationMs` + 投影测试 | done |
| WI-5 | 通用消费面对齐（徽标/摘要/快编/文本投影/快照/时间线） | done |

## 落点

- payload：`operation` + `position?`（复用 `StoryAlignPositionValue`）/`zoom?`/`rotation?`/`darkness?`/`durationMs?`/`easing?`。架构核实通过：`SceneCompileContext.nlrStory` 已在，`compileCameraAction` 直接取 `ctx.nlrStory.camera`，无新解析机械。
- **钳制**（卡的刚性要求）：`darkness` `Math.min(1,Math.max(0,…))`、`zoom` 下限 `0.05`、`duration` ≥0，且全部先过 `finiteOr`（NaN 进 Transform 会静默杀掉整段动画）。检查器同样在 `onChange` 处钳（align 0–1、zoom 同一下限），避免"存了检查器改不回来的值"。
- spec：`op`（enum，`core`）+ `amount`（union：placement 枚举 | number）+ `d=`（秒，存 ms）。placement 词表从 `spec.ts` 新导出的 `PLACEMENT_OPTIONS` 取，与 `placementParam()` 同源；`left/center/right → xalign` 由 `getPresetPosition` 唯一决定，不另立表。别名走 B6（`dim`→`darken`、`tilt`→`rotate`，补全插规范值）。

## 两处作用域告知（用界面自身表达，无解释性文案）

① **跨场景保留**：检查器区标题 `Camera · story-wide` / `镜头 · 跨场景保留`；`/` 菜单与指令手册的 detail 行写 "kept across scenes"（每条指令都有的同一个槽位，不是新增文案）。② **与 `/vignette` 区分**：camera 有自己的行徽标（`Aperture`＋`镜头`，不再落进 `Effect` 兜底）；darken 的字段叫 **Stage darkness / 舞台压暗**、operation 项叫 **Darken stage / 压暗舞台**——都点名"整个舞台"。`reset` 不需要额外显眼处理：`/camera ` 一敲，五个 operation 就是补全列表本身。

## 偏离与决策

1. **分类挂 `effects`（A1 需迁到「镜头」）**。没挂 `scene`：那会暗示场景作用域，而镜头恰恰不是。
2. **不碰 `ACTION_COMMANDS`**（卡的要求），故 `/camera` 目前**只在 `/` 面板/手册可达，侧栏无入口**——A1 把侧栏改成 spec 自动导出后自动补上。这是本卡唯一已知的可达性缺口。
3. **未新增 issue code**：`/camera zoom` 不写数值时取中性值（zoom 1 / rotate 0 / darken 0.5 / pan center）落块，与全仓"build 必须能从 `{}` 造出合法块"的约定一致；`/camera` 光杆则因 `op` 是核心而落草稿行。
4. **`amount` 是 enum|number 联合 → 补全噪音**（`/camera zoom ` 会同时列出 left/center/right）。不在补全层写指令特例（bible 明令）。提案（§11 开放项 2 相关，留给后续卡）：把 `content` 那套 `dependsOn` 泛化成"取值类型随另一参数解析结果切换"的通用 param kind，`/swap` 与 `/camera` 共用；在那之前这是可接受的papercut。
5. **舞台快照不模拟镜头**（`storyStageSnapshot` 走 `default: return`）：编辑器静态预览不表现镜头姿态。不算回归（video/audio 同样不模拟），但 A1 之后若要做值得单列。
6. §11 开放项 1（operation 够不够）：真机试用后维持 5 个，无追加提案。

## 验证

- `yarn lint`（5 个 tsc project）：**exit 0**。
- `vitest` 全量：**2010 通过 / 9 失败 = win32 基线原样**（path×3、runtimeProtocol×2、storageManager、GameBuildManager、mobileSigningIdentity、runMobileRepack），**新失败 0**。新增 4 条：编译产物形状＋钳制（zoom 0→0.05、darkness 2→`brightness(0)`）、行→块契约（含别名与中性值）、`op.core`、并行透镜时长派生。
- **真机（demo3，Dev Mode，截图存 `reports/assets/2026-07-25-a2-0*.png`）**：`/camera zoom|darken|pan|rotate` 各跑一次均实际生效（`-03/-04/-05`），darken 只压暗舞台、对话框不受影响（正是与 `/vignette` 的区别）。**跨场景姿态保留＝硬验收通过**：`-06` 与 `-07` 是**同一目标场景的同一句**——前者经 `/jump` 抵达，仍推近＋旋转＋压暗；后者从 jump 行直接起播（镜头中性），对照成立。并行容器透镜 `-08`：镜头 1s 满宽条、立绘移动 0.4s 短条，按比例绘制，无未知时长虚条。测试用的临时行已从 demo3 还原（storydoc 复原、camera 块 0）。

## 停机

无。三条停机条件均未触发：`nlrStory.camera` 可得、schema 无需 bump、无通用消费面需要大改（每一面都只是多一个 payload 分支）。

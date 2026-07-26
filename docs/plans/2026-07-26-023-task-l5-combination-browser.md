---
title: "task: L5 组合浏览器与命名快照"
type: task
status: done
date: 2026-07-26
parent: 2026-07-26-013-plan-layered-sprite-system.md
branch: feat/layered-sprite-l5
worktree: D:/Temp/nls-layered
---

# L5 组合浏览器与命名快照

母卡 `2026-07-26-013` §5「L5」。前置 L2（编辑器）与 L4（合成器）已并入 develop。

## 1. 组合浏览器

`characterCombinations.ts`（纯函数 + 单测）：轴的笛卡尔积。

- **有上限，并且说出来**：四个轴各四个 tag 就是 256 格，每格都要解码一整个栈。
  头部读数是 `已显示 / 总数`，截断的网格不会被读成一份完整清单。
- **「缺图格」的判定是本卡的关键**：一个层在**别的 tag 下有图、这个 tag 下没有**，那是美术的洞；
  一个层**哪里都没有图**，那是作者还没开始——诊断面板已经在说了，每一格再说一遍只会把真正的洞埋掉。
  所以只有前者点亮警告三角。

UI 是预览面的第二种形态（工具条上的网格图标切换），不新开面板：每格一张合成缩略（走 L4 的
`useCompositedSprite`，同一 key 共用解码），点格子应用该组合并回到单图预览，hover 出「起名」。

## 2. 命名快照

`snapshots?: CharacterSnapshot[]` 落在 `LayeredAppearance` 上，`{id, name, tags}`。
`createSnapshot` 先 `resolveTagSelection` 再存——快照永远命名一个**完整**的样子，
不会因为某个轴的默认值以后改了而漂移。

**故意只是编辑器便利**：故事行存 tags，永远不存 snapshot id。让行引用快照就得进故事 schema，
并且改名/删除快照立刻变成引用完整性问题——母卡 §9 把这个问题留着，本卡不替它做决定，
也没有堵死它。

## 3. 判据与结果（2026-07-26，orchestrator 亲手驱动 + 亲自读图，CDP 9224）

| # | 判据 | 结果 |
|---|---|---|
| 1 | 网格是轴的笛卡尔积，每格合成缩略 | ✅ 两轴各两 tag → 头部 `4  Clothing × Expression`，四格分别是 `Uniform·Happy` / `Uniform·Angry` / `Casual·Happy` / `Casual·Angry`，缩略图里能看出 Brows 层随表情换（NarraLeaf 条 vs MewBaka 猫） |
| 2 | 缺图格标出来 | ✅ 给 Clothing 加了个没配图的 `Casual`：两格 `Casual·` 少了 Body 层、并亮起琥珀三角；两格 `Uniform·` 干净 |
| 3 | 起名 → 快照 | ✅ 从格子起名 `Angry uniform`，右栏出现 Snapshots 段，落盘 `{"id":"s27s","name":"Angry uniform","tags":{"x1ya":"t7s2","x2xk":"tazu"}}`——存的是 id |
| 4 | 上限如实报告 | ✅ 单测：`limit=3` 时 `combinations.length===3` 而 `total===4` |
| 5 | lint / test 无新增失败 | ✅ 五个 tsconfig 全绿；character/i18n 定向测试 36 通过 |

## 4. 母卡 L5 的第三条：诊断汇总与 ReferenceService

**已经在 L1 就落了**，本卡只做了核对：`referenceModel` 按「层 × tag」建键
（`char:c1:layer:l1:t1`），单测锁着"一层多 tag 不会塌成一条"。没有重做。

## 5. 明确不做

- **快照被故事行引用**：母卡 §9 的开放问题，见 §2。
- **诊断汇总进资产总览面板**：诊断已经在角色编辑器里，搬进总览是资产面那条线的活。
- 头像裁剪、Dev Mode 快照合成——L4 卡 §5 已登记。

---
title: "task: L4 SpriteCompositor — 一张图，而不是最底下那层"
type: task
status: done
date: 2026-07-26
parent: 2026-07-26-013-plan-layered-sprite-system.md
branch: feat/layered-sprite-l4
worktree: D:/Temp/nls-layered
---

# L4 SpriteCompositor

母卡 `2026-07-26-013` §3.5 与 §5「L4」。母卡原本把编译器与故事侧一并放在 L4，那些在 L1 就落了
（schema v9→v10、`/show` 补默认 `/face` 增量、选择器两档、行内 token）。**L4 剩下的就是 §3.5**：
分层立绘没有单一 URL（`Image.getSrcURL` 返回 null），所以每一处"拿角色的一张图"都得改成合成。

## 0. 开工时先修了 develop

`5b59032e` 顶着 `docs(plugin)` 的消息落了一棵**过期的树**：9020 行删除，跨四个会话——
sidecarHost 及其测试、整个 runtimePluginHost 家族、pluginManifest 与安装权限、
pluginBuildDependencies、分层立绘编辑器与诊断、以及三张卡（016/017/018）。
忽略换行后大部分 diff 是整文件重写，是"分支点在那些合并之前"的签名，不是有意的改动。
用户裁决**整个 revert**（`b95e61ad`，已推 origin/develop）。那次提交本想带的插件 API 改造
（统一 `ctx.game`、manifest 结构）要在当前基线上重做。

## 1. 服务

`spriteCompositor.ts`：

- `spriteCompositeKey(characterId, selection)` —— 合成物的身份。tag 键**排序**后入键：
  一个 tag map 的插入顺序是"哪一行先写的"的偶然结果，两行摆出同一个姿势必须命中同一条缓存。
- `SpriteCompositor.composite(key, layers, maxSize?)` —— 返回 object URL；同 key 同尺寸只画一次，
  并发请求折叠成一次绘制；URL 由缓存持有，**调用方不得 revoke**。LRU 上限 48，淘汰即 revoke。
- `invalidate(prefix)` —— 角色的层栈或它用到的资产变了就整块丢弃。
- `occlusion(layers, grid)` —— 每一层是否被上面的层完全盖住。

**绘制是注入的**（`SpriteRenderer`），所以缓存、键、淘汰能在没有 canvas 的 node 里单测；
遮挡判定也因此跟合成共用同一次 decode，而不是对同一个 alpha 问题给出第二个答案。

`useCompositedSprite(character, selection, maxSize?)` 把它接到工作区：一个窗口一个 compositor
（一个窗口就是一个工程），所以徽章、选择器、缩略图问同一张图时共用一次解码和一个 URL。

`CharacterAppearance.resolveDrawList(selection)` 新增：一个选择下自下而上画什么。
preset 是"只有一格的栈"——这正是让合成器和预览对两档一视同仁的东西。

## 2. 改到的消费面

- **故事行徽章**：分层角色走合成（`BADGE_COMPOSITE_PX = 96`，够 40px 板子在 2x 下用）。
  单资产那条路**仍然跑**——它是合成还没画完时徽章显示的东西，滚动列表因此不会闪空板。
- **选择器**：分层档左侧加一张合成缩略。一列 tag 名字说不出这个组合搭起来好不好看。
- **遮挡诊断**（L2 欠的）：`collectCharacterDiagnostics` 多收一个 `occluded` 入参，
  编辑器用 compositor 的离屏 pass 算出来传进去。

## 3. 判据与结果（2026-07-26，orchestrator 亲手驱动 + 亲自读图，CDP 9224）

| # | 判据 | 结果 |
|---|---|---|
| 1 | 故事行徽章显示合成图而非某一层 | ✅ 把一行指到分层角色，徽章 `img.naturalWidth×Height = 74×96`——正是 1524×1984 包围盒缩到 96 长边；原始层是 1088×1984。放大看：立绘上叠着 Brows 层的蓝色横条 |
| 2 | 选择器显示合成图 | ✅ `123×160`（同一包围盒缩到 160）。放大看是"人物 + 蓝条"两层叠加 |
| 3 | 遮挡诊断 | ✅ 小按钮层在整幅立绘之下 → `Button is completely covered by the layers above it`（warning，琥珀图标）；把按钮移到最上层 → 警告消失 |
| 4 | 同一张图只画一次 | ✅ 单测：同 key 同尺寸 `render` 只调一次，并发请求折叠；换尺寸才重画 |
| 5 | lint / test 无新增失败 | ✅ 五个 tsconfig 全绿；`vitest` 2353 通过 / 8 失败，8 条全是 win32 既有基线 |

**一个被真机逼出来的坑**：第一版 `sampleAlpha` 把每一层都 `drawImage(bitmap, 0, 0, grid, grid)`
拉满整个网格，于是一个居中的小配件会被当成"盖住了全画布"。必须在**画布坐标系**里采样——
按层相对画布的尺寸居中缩放，跟栈实际绘制的方式一致。改前这条诊断会对着几乎任何栈乱报。

## 4. 已知不一致（下一张卡）

编辑器预览 `LayerStackPreview` 用的是**每层各自 `object-contain`**：一个 82×43 的层会被放大到
整个预览框。合成器则按"各层按自身尺寸居中"画——那才是引擎的规则，也是画布约束存在的理由。
于是同一个栈在预览面和徽章/选择器里长得不一样，而且预览面**看不出**尺寸不符（诊断照报）。
应当把预览改成与合成器同一套摆放。没有并进本卡：它会动到 L2 刚验收过的那个面，
值得单独一张卡 + 单独一次目视。

## 5. 明确不做（留给后续卡）

- **头像裁剪（`portrait`）在合成结果上框选**：母卡列在 L2，需要一个交互式裁剪面，自成一卡。
- **Dev Mode 快照**：母卡 §8 判据 7 的第三处。Dev Mode 走的是编译产物而不是这套渲染器缓存，
  接进去要先想清楚 compositor 在 dev-mode 窗口（没有 workspace context）里怎么拿资产。
- **资产总览的角色分组卡 / story-motion 选择器**：同一套 hook 换上去即可，纯机械，没验就不写。
- **组合浏览器与命名快照**（L5）、**PSD 导入**（L3）。

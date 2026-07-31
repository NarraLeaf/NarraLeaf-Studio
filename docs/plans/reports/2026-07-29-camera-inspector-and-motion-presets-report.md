---
title: "report: /camera 属性编辑器重设计 + Story Motion 预设动画库"
type: report
status: done
date: 2026-07-29
parent: 2026-07-29-002-task-camera-inspector-and-motion-presets.md
---

# report

分支 `feat/story-camera-motion`（worktree `D:/Temp/nls-camera`，off develop `7c77eafd`），3 个 commit。

| 交付 | 状态 |
|---|---|
| 镜头能应用 Story Motion（新 op `motion`，编译/快照/透镜/快编/行摘要全线） | done |
| `/camera` 属性编辑器重设计（六向选择器 + 取景器 + 滑杆） | done |
| Story Motion 预设动画库（33 条 / 6 分类）+ 可浏览画廊 | done |
| 真机验收（orchestrator 亲眼看 + 22 项探针） | done |

## 落点

**D1 镜头吃 Motion**：`operation` 加 `"motion"`、payload 加 `motion?: StoryTransformRef`，加性不 bump schema。
编译复用 `createAnimationTransform` + `camera.transform(...)`；**快照复用 `storyTransformRefFinalProps`
落定终态**，所以行级起播落在 `/camera motion` 之后时镜头不会回中性（A2 报告 §5 记的那类保真缺口没在新 op 上复现）。

**D2 target kind**：新 `StoryMotionTargetKind = StoryDisplayableTargetKind | "camera"`，只用于动画资产与预览目标；
**没有**拓宽 `StoryDisplayableTargetKind`（那会让 `/transform` 把镜头列成候选目标）。
`normalizeAnimationTargetKind` 必须同步——它的兜底是**静默改写成 `image`**，漏一行就把作者的镜头动作丢进每个立绘的选择器。

**D3 编辑器**：搬到 `CameraActionEditor.tsx`。核心是**取景器**：把当前 op 那一路画成舞台矩形
（zoom 缩放、rotate 旋转、darken 压暗、pan 可拖拽），对齐→CSS 的映射与 Story Motion 预览同源，
且**对话框条画在移动矩形之外**——这正是 `/camera darken` 与 `/vignette` 的区别，用图说而不是用句子说。

**D4/D5 预设库**：`storyMotionPresets.ts` 33 条（入场 6 / 退场 2 / 强调 5 / 待机 3 / 反应 8 / 镜头 9），
含用户点名的**摇晃**与**震动**。三条硬规则写进代码与测试：只动 offset 不动 align、循环只给有限次数、
预设是种子不是引用。旧的 4 条 `STORY_MOTION_TEMPLATES` 与 `motion.templates.*` 删除，三处调用点迁移。

**顺带修掉的两个既有缺陷**（都不是本卡引入的，但本卡把它们暴露成了硬伤）：
1. 占位主体是**固定 128×160 CSS px**，在 1920 舞台缩到 148px 卡片里只有 10×12px——预设画廊的立绘半边因此是一排空方块。改成按舞台比例取尺寸，既有的悬停预览一并受益。
2. `/camera motion` 行只读作 "Motion"。投影加了可选 `motionName` 查表（沿用 `assetName` 已有的纯函数/服务分工），行现在读作 "Motion Camera Shake"。

## 三处"测试逼出来的修正"（值得记住的部分）

1. **画廊停帧不能是 t=0**：几乎每条动作都从静止开始，24 张卡片停在 0 就是 24 个一模一样的方块。改成停在"偏离中性最远的一帧"后，测试立刻抓到第二个坑：入场类的最远一帧**就是全透明的第一帧**——`fadeInSlide` 停在了空白。最终解法是**在关键帧之间也采样**，并把偏离度**乘以不透明度**。
2. **`shake` 的两个峰值同分**（−10@60ms 与 +10@120ms），取前者。是稳定但任意的 tie-break，测试把它钉住了。
3. **`/camera motion` 的 `d=`**：透镜与快编都必须当它不存在。spec 建块时会落一个 600ms 默认值，照着画就是一根自信但错误的条。

## 验收

- 四个 tsc project：**exit 0**（worktree 里 `yarn lint` 走不通，直接跑 `npx tsc -p`）。
- vitest 全量：**3578 通过 / 9 失败 = win32 基线原样**（path×3、runtimeProtocol×2、storageManager、GameBuildManager、mobileSigningIdentity、runMobileRepack），**新失败 0**。新增 15 条测试（预设库结构 13 + 镜头编译/快照 2 + 透镜 1 + 行摘要 1 + storyModel 1，另有既有测试迁移）。
- **真机 22/22**：`tools/ui-verify/scenarios/camera-inspector-and-motion-presets.js`（新增，永久产物）。
  在**干净工程副本**上跑完整链路：`/camera zoom 1.8 d=0.9` 落行 → 检查器六向选择器 → 取景器按 1920/1080 比例绘制、
  拖滑杆重绘（scale(1.8)→scale(3)）→ pan 变拖拽面且点击写入落点的 align（74.93% / 74.85%）→ motion 换成动作字段 →
  选择器在无镜头动作时**默认开在预设页** → 镜头预设 7 条在列、立绘预设 0 泄漏 → 卡片停帧 7/9 互异 →
  选 Shake 落资产（`targetKind: "camera"`、名字 `Camera Shake`）→ 行读作 "Motion Camera Shake" → 落盘 payload 正确；
  另跑立绘半边：portrait 得到 5 条立绘预设、镜头 shot 0 泄漏、分类是可显示对象那 6 个、主体按 422×670 舞台 px 绘制。
- **orchestrator 亲眼看了四张截图**（`tools/ui-verify/out/2026-07-29-camera-*.png`，未入库）。看图之后改掉了四处探针全绿但设计不合格的地方：
  滑杆右侧的格式化读数与数字框重复、绑定后动作名被摘要挤成 "Stag…"、`Stage camera Camera shake` 的口吃命名、以及上面第 1 条空方块。

## 已知缺口 / 后续

1. **角色预设预览没有立绘图**：`storyMotionPreviewTarget` 只读 `payload.assetId`，而 `/show Alice`（未指定差分）不落 assetId，于是 portrait 以"立绘形状的占位框"试演。既有的悬停预览一直如此，正解在外观解析器（见 [[nlr-dialog-avatar-api]] 的 resolver），不属于本卡。
2. **小幅动作的停帧几乎看不出来**：±10px 的 shake 在 148px 卡片上是 0.8px。这类动作**本来就没有"有特征的姿态"，只有有特征的运动**，悬停即动即可；夸大幅度会是撒谎。
3. **`/camera motion` 在 Dev Mode 时间线上读作 "Motion"**：那一侧的 bundle 不带动作索引，`motionName` 缺省即退化。要修就得往 Dev Mode bundle 里加一张 id→name 表。
4. **行内插入按钮的可访问名是光秃秃的 "Insert"**（`title` 才是完整句子）。既有缺陷，验收时被它绕了一轮；已单独开卡。

## 停机

无。

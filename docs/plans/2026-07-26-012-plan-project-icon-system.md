---
title: "plan: 工程图标系统 — 一张母版，六个目标"
type: plan
status: ready
date: 2026-07-26
branch: feat/project-icon-system
---

# plan: 工程图标系统

Project 边栏 ▸ Assets 这一页，今天是「五个上传槽」。构建目标已经有六条了，图标系统还停在占位阶段。
这张卡把它换成 Studio 级：**作者只维护一张母版，平台行从输入变成结果**，要覆盖的地方一键覆盖。

## 0. 分支与纪律

- 分支 `feat/project-icon-system`，从 `develop`（**`b0b9c192`**）切出。
- 共享检出上另有 session 在 `feat/ui-u2-inspector-follows-selection` 上带着未提交改动干活。
  **本卡在独立 worktree（`D:/Temp/nls-icons`）里做**，不碰共享树。
  实现回合开工第一件事：把 `node_modules` junction 过去（`mklink /J`），别在 worktree 里重装依赖。
- 逐文件 `git add`，**禁止 `git add -A`**；每个 WI 完成即 commit；不合并、不 push。
- 禁止 `git stash`、禁止 `git worktree remove` 别人的树。提交前先 `git branch --show-current`。
- `yarn lint` 只跑 tsc——"lint 绿"只证明类型，不证明行为。
- i18n 有 en/zh key 集合的 parity 测试，新键必须两边都加。

## 1. 现状（本轮实测，不是回忆）

### 1.1 数据模型

`ProjectMetadata.icons`（`src/renderer/lib/workspace/project/project.ts:33`）：

```ts
type ProjectIconPlatform = "macos" | "windows" | "linux" | "android" | "ios";
icons: Partial<Record<ProjectIconPlatform, { path; sourceName; mediaType; updatedAt }>>
```

五个互不相干的槽位，每个存一个**原始文件**，由 `importProjectIcon` 拷进
`resources/icons/app-icon-<platform>.<ext>`。没有母版概念，没有任何加工。

### 1.2 六条目标怎么消费图标

| 目标 | 路径 | 现状 |
|---|---|---|
| windows / macos / linux | `GameBuildManager.resolveTargetIcon` → `iconPath` | 原始文件**直接**交给 electron-builder |
| android / ios | `resolveMobileIcons` → `writeScaledIcons`（`nativeImage`） | 现算进 shell 模板声明的每个 slot |
| **web** | `copyWebFavicon` | **没有图标槽**：从 windows→linux→macos 里捡第一个 PNG 当 favicon |
| Dev 预览产物 | `gameRuntimeArtifactCompiler` | 把配置的图标原样拷进产物 |

slot 尺寸是**从 shell 模板 zip 里读出来的**（`readIconSlotSizes`，模板占位图多大就出多大）。
这条不能破：density 知识属于 shell 仓库，不该复制进 Studio。

### 1.3 已确认的缺陷

| # | 缺陷 | 证据 |
|---|---|---|
| D1 | **web 没有自己的图标**，只配移动端 = 整个 web 导出没有 favicon | `copyWebFavicon` 只看 windows/linux/macos |
| D2 | **构建对话框只画三个图标** | `BuildDialog.tsx:440` 遍历 `DESKTOP_PLATFORMS`，`BuildIconRow` 的类型就是 `GameBuildDesktopPlatform` |
| D3 | **非正方形源会被拉变形** | `writeScaledIcons` 调 `resize({width, height})` 两边都给，Electron 不保比例 |
| D4 | **iOS 保留 alpha** | 同上，`toPNG()` 原样输出；带透明通道的图标 App Store 会拒，设备上圆角外会发黑 |
| D5 | **`.ico`/`.icns` 不校验** | `pngIconIsUnusable` 只认 PNG，非 PNG 一律 `return false` |
| D6 | **"配了图标却没生效"是静默的** | 尺寸不够 → warning + 换成 Electron 默认图标，作者在产物里才发现 |
| D7 | 预览是 64px `object-contain` 裸图 | 看不出 macOS 留白、Android 遮罩、iOS 圆角实际长什么样 |
| D8 | 同一份配置有**三个读取器** | renderer `ProjectService`、main `preflight`、main `gameRuntimeArtifactCompiler` 各写一遍 |

## 2. 目标 / 非目标

**目标**

1. 作者只需要准备**一张**高分辨率方图；六条目标全部有正确的图标。
2. 需要为某个平台换图或微调时，**一键**，就在那个平台格子上，不跳页。
3. 平台行显示的是**出片结果**（带该平台的遮罩/留白/底色），不是输入槽。
4. iOS 无 alpha、非方图不变形、web 有 favicon + apple-touch。
5. 一个配置读取器，三处共用。

**非目标（本轮不做）**

- PWA `webmanifest` / 可安装（已裁决：只做 favicon + apple-touch）。
- Android 自适应图标前景/背景双层——shell 模板现在只声明 legacy `ic_launcher.png` slot，
  等模板支持了再开卡。
- 图标编辑器（画笔、圆角自绘）。Studio 不做美术工具。
- 新依赖。烘焙用 canvas，降采样用 `nativeImage`，都已在手。

## 3. 设计

### 3.1 模型：母版 + 平台配方

```ts
// src/shared/types/projectIcons.ts（新文件，三处共用）
export type ProjectIconTarget = "macos" | "windows" | "linux" | "android" | "ios" | "web";

export type ProjectIconSource = {
    path: string;          // 工程相对路径
    sourceName: string;    // 作者选的原始文件名，只用于显示
    mediaType: string;
    updatedAt: string;
};

export type ProjectIconSpec = {
    /** 有值 = 这个平台不用母版，用它自己的图。多数平台永远是 null。 */
    override: ProjectIconSource | null;
    /** 内容占画布的内缩比例，0–0.25。安全区/留白就是这一个旋钮。 */
    inset: number;
    /** 透明像素压在什么颜色上；null = 保留透明。iOS 强制非 null。 */
    background: string | null;
};

export type ProjectIconSet = {
    version: 2;
    master: ProjectIconSource | null;
    specs: Record<ProjectIconTarget, ProjectIconSpec>;
    /** 已烘焙产物 + 其配方指纹，用于判断是否过期。 */
    baked: Record<string, { path: string; fingerprint: string }>;
};
```

配方只有三个旋钮，且**默认值就是对的**，多数工程一个都不会动。

### 3.2 各目标的默认配方

| 目标 | 烘焙画布 | 默认 inset | 默认底色 | 依据 |
|---|---|---|---|---|
| macOS | 1024 | **0.10** | 透明 | Big Sur 图标栅格：图形占 824/1024，四周留白 |
| Windows | 1024 | 0 | 透明 | 满幅，electron-builder 转 `.ico` |
| Linux | 1024 | 0 | 透明 | 满幅 PNG 直用 |
| Android | 1024 | **0.08** | 透明 | legacy launcher 图标会被启动器套圆形/圆角遮罩，顶满会被切角 |
| iOS | 1024 | 0 | **`#FFFFFF`（已裁决：默认白，可改）** | 系统自己圆角；**必须无 alpha** |
| web | 512 → 32 / 180 | 0 | favicon 透明；apple-touch 同 iOS 规则（不透明） | |

这些默认值在**首次烘焙时就写死进 `specs`**，不留"跟随默认"的悬空状态——理由见 §3.4 最后一条。

### 3.3 烘焙在作者时（已裁决），但只烘焙到"平台母版"这一层

裁决是**作者时烘焙**：派生结果落进工程目录，外部工具能直接用，也能手工替换某一张。
但 mobile 的 slot 尺寸来自 shell 模板（Studio 版本相关，工程里没有），所以分工必须切在正确的地方：

- **作者时（renderer, canvas）**：把母版按配方**合成**出每个目标的成品母版。
  合成 = 保比例 fit + inset 内缩 + 底色压平 + 逐级折半降采样（一步 1024→32 会糊，必须 halving）。
- **构建时（main, `nativeImage`）**：只做**纯降采样**，把已烘焙的平台母版缩进模板声明的 slot。
  不再做任何合成——D3/D4 因此在源头消失（进 slot 的图已经是方的、iOS 的已经不透明）。

磁盘布局：

```
resources/icons/
  source/
    master.png                 ← 作者提供的唯一输入
    ios.png                    ← 只有被覆盖的平台才有
  derived/
    macos.png  windows.png  linux.png  android.png        (1024)
    ios.png                                               (1024, 无 alpha)
    web-favicon.png  (32)      web-apple-touch.png  (180, 无 alpha)
```

7 个派生文件。`fingerprint` = `hash(源文件字节) + 配方序列化`，写在 `baked` 里：

- 面板打开时指纹不符 → **静默重烘焙**（作者感知不到）。
- preflight 指纹不符（例如有人在 Studio 之外覆盖了源文件）→ `icon-stale` warning。

### 3.4 派生产物是隐式工程资产，要进 VCS

烘焙结果**不是缓存**。它们和母版一样是工程内容：随 `.nlspkg` 导出、进 Lore 版本库、
在别人的机器上直接可用而不必重烘焙。

- **位置已经对了**：`shouldExcludeProjectPackagePath` 只排除 `.nlstudio/`、`editor/cache/`、
  `editor/assets/remote/`、`exports/`；`resources/icons/derived/` 走的是普通工程路径，
  打包和版本库自动带上。**绝不能挪进 `.nlstudio/`。**
- **"隐式"= 不进资源注册表**：不给 UUID、不写 `assets.metadata.*.json`、不进
  `assets/content/`。理由有二：那份 metadata 本身是受版本控制的文件，每次重烘焙都会
  搅出无意义 diff；而且注册了就意味着这些图会出现在资源选择器里，谁都能把 iOS 图标
  当背景图用。它们是工程文件，不是作者管理的资源。

而只要东西进了 VCS，**确定性就成了硬需求**——否则每次打开工程都是一屏假 diff：

| 规则 | 做法 |
|---|---|
| 字节稳定 | PNG 不写 `tIME`/`tEXt`；canvas 编码器本身不写时间戳，但仍按下一条兜底 |
| **写前比对** | 新字节 hash 与磁盘上现有文件相同 → **不写**。不碰 mtime，不产生空提交 |
| 指纹用内容 | `fingerprint` 只由 `hash(源字节) + 配方` 组成，**不含 `updatedAt`/mtime** |
| 配置稳定 | `baked` / `specs` 的键**排序后**写入，msgpack 编码顺序才不会跳动 |
| **默认值冻结** | 烘焙时把当时生效的默认 `inset`/`background` **写死进 `specs`**，不留"跟随默认" |

最后一条是被 VCS 需求反推出来的，和直觉相反、值得记一笔：本来"没动过的旋钮跟随默认值"
更优雅（将来调默认值能自动惠及旧工程），但那意味着**队友的 Studio 版本不同，
烘焙结果就不同**——他一开工程就产生一批他没动过的 diff。可复现性优先于自动升级。

### 3.5 UI：输入是一格，平台行是结果

Assets 子页改成两块，**不加任何解释性文本**（沿用既有铁律）：

```
┌────────────────────────────────────────────┐
│              ┌──────────┐                  │
│              │  母版 96 │   ← 拖入 / 点击导入 / 从工程资源选
│              └──────────┘                  │
├────────────────────────────────────────────┤
│  ◇mac  ■win  ■linux  ●droid  ▢ios  ▫web    │  ← 6 格结果预览，各带该平台遮罩
└────────────────────────────────────────────┘
```

- 六个平台格画的是**烘焙后的结果**，并套上该平台真实形状：macOS/iOS 超椭圆、
  Android 圆形遮罩、Windows/Linux 方、web 画 32px 实际大小。D7 就此消失——
  留白不够、被切角、透明漏洞，全是**看得见**的，不需要一句文案去说。
- 点某一格 → 就地展开该平台的三个旋钮（不弹模态、不跳页）：
  覆盖图（导入/清除，复用现有文件选择器）、`inset`（`Slider`）、底色（swatch，
  沿用 `SettingColorPicker` 的 `<input type="color">` 写法）。
  没被覆盖、没被调过的格子不显示任何多余控件。
- 母版格支持拖放文件（`.nl-drag-source` 那套约束只管拖出，拖入是普通 DnD）。
  "从工程资源里选"复用 `AssetSelector`。
- 复用组件：`Slider`、`EnhancedInput`、`controlButtonClass()`、`AssetSelector`、
  `iconPreview.ts` 的 `.icns` 抽取。**不新增依赖，不加 chip/徽章/空态插画/`title` tooltip。**

### 3.6 母版过小（已裁决：照常出片 + warning）

低于目标画布就放大出片，preflight 报 `icon-low-resolution` warning；面板上那一格自己就是糊的，
一眼可见。**不再回退到 Electron 默认图标**——D6 的"我明明配了却没生效"是现在最迷惑的行为。

## 4. 迁移（v1 → v2，不改变现有工程的出片结果）

旧工程有至多 5 个互不相干的槽位。规则：

1. 按 `windows → macos → linux → android → ios` 取**第一个**已配置的作为 `master`。
2. 其余每个已配置的平台，原样变成该平台的 `override`。
3. 所有 `inset` = 0、`background` = null（iOS 例外：压白），即**逐字节沿用旧行为**，
   除了 iOS 去 alpha 和非方图不再变形——这两个是修 bug，不是行为漂移。
4. 迁移后立即烘焙一次，写 `baked`。

迁移是**非破坏性**的：旧的 `app-icon-<platform>.<ext>` 文件不删，只是被 `source/` 引用。

## 5. WI 拆分

| WI | 范围 | 关键文件 |
|---|---|---|
| **WI1** | 共享模型 + 规范化 + 迁移。一个读取器，renderer/preflight/artifactCompiler 三处共用（治 D8） | 新 `src/shared/types/projectIcons.ts`；改 `project.ts`、`ProjectService.ts`、`preflight.ts`、`gameRuntimeArtifactCompiler.ts` |
| **WI2** | 纯几何：`(源尺寸, 目标, spec) → {画布, 绘制矩形, 底色, 是否压平}`。renderer 烘焙和 main 降采样共用同一份，保证"所见=所出" | 新 `src/shared/utils/iconRecipe.ts` + 单测 |
| **WI3** | 作者时烘焙器（renderer/canvas）：保比例 fit、inset、压平、逐级折半降采样、`.icns` 抽取、写 `derived/`、内容指纹。**含 §3.4 全部确定性规则：写前比对、键排序、默认值冻结** | 新 `.../project/iconBake.ts`；扩 `ProjectService`（`writeRaw` 已有） |
| **WI4** | 构建端改成消费烘焙产物：桌面交派生 1024 PNG（native 容器覆盖则原样透传）；`writeScaledIcons` 退化为纯降采样（治 D3/D4） | `GameBuildManager.ts`、`mobileIcons.ts` |
| **WI5** | web 目标图标：favicon 32 + apple-touch 180，`index.html` 写 link 标签（治 D1） | `webShell.ts`、`gameRuntimeArtifactCompiler.ts` |
| **WI6** | preflight 改造：`icon-missing` 降为"一条，没有母版"；新增 `icon-low-resolution`、`icon-stale`；`.ico`/`.icns` 也校验尺寸（治 D5/D6） | `preflight.ts`、`gameBuild.ts`、`build.ts` i18n |
| **WI7** | 面板重写（§3.4）+ en/zh 文案 | `ProjectAssetsSection.tsx`、`catalog/{en,zh}/project.ts` |
| **WI8** | 构建对话框图标行画**六**格烘焙结果（治 D2） | `BuildIconRow.tsx`、`BuildDialog.tsx` |

依赖：WI1 → WI2 → {WI3, WI4} → {WI5, WI6} → {WI7, WI8}。WI7 可与 WI4/5/6 并行。

## 6. 验收

- 单测：`iconRecipe` 几何（含非方图、inset 边界、iOS 强制不透明）、v1→v2 迁移、
  `readIconSlotSizes` 不变、preflight 新码。
- 真机：新建工程 → 只丢**一张** 1024 母版 → 六格全部出图；构建 win + web + android，
  产物里 `.exe` 图标、`favicon.png`/`apple-touch-icon.png`、APK 里 mipmap 各 slot 都是母版。
- iOS 产物 PNG 用 `python -c` 读 IHDR 颜色类型确认**无 alpha 通道**。
- 老工程（有独立 win/mac 图标的）打开 → 迁移成 master + override，出片与迁移前一致。
- **VCS 空转测试**：烘焙一次后 `git status` 干净 → 关掉工程重开、再进 Assets 页 → **`git status`
  仍然干净**（面板打开触发的重烘焙必须写前比对、一个字节都不落盘）。这是最容易做错的一条。
- 派生文件随 `.nlspkg` 导出：导出→在别的目录导入→六格立刻有图且**没有触发重烘焙**。
- **UI 验收由 orchestrator 亲眼看**（铁令）：agent 报告、截图、测试绿都不算。
- 隔离树审计：`git archive HEAD | tar -x` 到干净树上跑 `yarn lint` + `yarn build:apps:dev`，
  报告里贴命令、退出码、`git status`（应为空）。

## 7. 裁决记录（2026-07-26，用户）

| 问题 | 裁决 |
|---|---|
| 派生在哪发生 | **作者时烘焙**（派生文件进工程目录） |
| iOS 底色默认 | **白，可改** |
| web 范围 | **favicon + apple-touch**，不做 webmanifest/PWA |
| 母版过小 | **照常出片 + preflight 警告**，不回退默认图标 |

## 8. 未决

- `inset` 的两个默认值（macOS 0.10 / Android 0.08）是按平台栅格规范定的，
  实现回合出片后由 orchestrator 目视确认一次，不合适就在 §3.2 表里改。
- Android 自适应图标要等 shell 模板声明前景/背景 slot，另开卡。

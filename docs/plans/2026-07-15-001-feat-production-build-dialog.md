---
title: "feat: Production Build 配置弹窗重构"
type: feat
status: blocked
date: 2026-07-15
---

# feat: Production Build 配置弹窗重构

> **状态：暂停，等 web 构建目标落定。**
> 2026-07-15 发现 `src/shared/types/gameBuild.ts` 与 `src/renderer/lib/workspace/project/configuration.ts`
> 正被并行修改（新增 `web` 平台：`GameBuildPlatform` 加 `"web"`、新增 `GameBuildDesktopPlatform`、
> `hostCanBuildTarget` 对 web 恒真、`GAME_BUILD_FORMATS_BY_PLATFORM.web = ["zip", "dir"]`）。
> 本计划要改的正是这两个文件，且 web 平台会实质改变界面方案（见下「web 带来的未决问题」）。
> 恢复条件：web target 的类型与管线都落定、工作区干净。

## Overview

现在的构建弹窗（`BuildDialog.tsx`，460px 单列）名义上是「构建配置」，实质只是一个**目标选择器**：真正可配的只有两项——平台×格式、输出目录。版本号和资源保护是只读死文本，其余一切（架构、压缩、产物命名、构建后行为、镜像）要么硬编码在管线里，要么散落在别的面板。

四个具体问题：

1. **失败太晚。** `metadata.version` 非法会在 `GameBuildManager.resolveIdentity` 里直接 throw；插件依赖校验、图标尺寸校验也都在点了 Start、等过 preparing/compiling 之后才报。这些检查**全部**可以在弹窗里前置。
2. **产物不可预测。** `artifactName` 模板固定，但弹窗里看不到会产出什么文件、几个、落在哪。
3. **配置散落四处。** 图标在 Project▸资源、版本在 Project▸详情、加密在 Project▸设置、Electron 镜像在全局设置▸高级。
4. **管线能力没暴露。** `dir` 格式已支持但没提供；架构硬编码（本机跟随 `process.arch`，跨平台一律 x64）——Apple Silicon 上构建 macOS 只出 arm64；`metadata.copyright`/`license`/`author` 存了但 `src/main` 零消费。

本计划把弹窗从「选目标」重构为**「构建前的检查清单 + 配置台」**。

## 界面方案（已定稿，2026-07-15 评审通过）

820×~560 双栏：左栏 132px 分区导航（带预检状态点），右栏内容，底栏只有取消/开始构建。

评审砍掉的东西，以及为什么——**这些是设计约束，不要在实现时又长回来**：

- **版本号不配任何「升 patch/minor/major」按钮。** 版本号对工作室是常识标识，给它发明三个操作词是凭空造生词、抢焦点。就是一个 input，非法时红边框 + 一句行内说明。
- **底栏不放摘要行**（「将产出 N 个文件 · 预检 X 项错误」）。产物竖着列全在「输出」分区；底栏只有两个按钮。
- **不做构建预设**（发布构建/快速验证/上次配置）。同样是生词抢焦点；「文件夹」格式本身就是那条快路径，不需要包装成概念。
- **「内容与保护」里的状态直接写成文字，不要 chip/badge。**
- **不可用平台的原因收进 tooltip**，不常驻一行。
- **Start 不 disable。** 有阻断错误时点它 → 跳到出问题的分区。这与现有 `BuildDialog.tsx` 的 `showNotification` + return 是同一套路；红点是常驻信号，底栏一个字都不用加。

### 分区内容

1. **目标** — 平台开关 × 格式 pill × 架构下拉 · 跨平台上下文提示（含镜像入口）。
2. **标识** — 版本（可编辑，唯一硬失败字段）· 产品名（只读，源自项目名）· 应用 ID（只读，派生）· 版权 · 三平台图标真实预览。
3. **内容与保护** — 资源保护开关 · 随包插件 · 随包语言 · 网络策略 · 未签名说明。全部纯文字。
4. **输出** — 输出目录 · 产物文件名列表 · 构建后打开输出目录 · 压缩。

### 预检状态点

左栏每个分区一个低饱和状态点，`error` 阻断、`warning` 不阻断。交互闭环：**红点 → 点进去 → 就地改 → 点消失 → 可以构建**。

| 分区 | error | warning |
| --- | --- | --- |
| 目标 | 未选任何目标；宿主无法构建所选平台 | 跨平台需下载 Electron |
| 标识 | `metadata.version` 非法 semver | 无 `identifier`；图标缺失或 <512×512 |
| 内容与保护 | 插件依赖校验失败；`encryptAssets` 开但密钥不可解析 | 未签名分发 |
| 输出 | 输出目录不可写 | 输出目录非空 |

## 关键技术结论（已验证，勿重新推导）

### electron-builder 宏展开规则（读 node_modules 源码确认）

现有模板：`` `${artifactBaseName}-\${version}-\${os}-\${arch}.\${ext}` ``（`runGameBuild.ts:55`）

- `${os}` ← `Platform.buildConfigurationKey`（`core.js:46-48`）：macOS → `mac`、Windows → **`win`**、Linux → `linux`。
- `${ext}`：zip → `zip`、nsis → `exe`、dmg → `dmg`、appimage → `AppImage`。
- `${arch}` ← `getArtifactArchName(arch, ext)`（`builder-util/out/arch.js:58`）。**陷阱：AppImage/rpm/flatpak 的 x64 展开成 `x86_64` 而不是 `x64`**；deb/snap 的 x64 → `amd64`。朴素预测在这里会给出错误文件名。
- **`arch == null` 时**（`macroExpander.js:6-16`）模板里的 `-${arch}` 整段被 `String.replace` 删掉（只删首个匹配），`${arch}` 展开为空串。
- 因为我们设了 `config.artifactName`，`isUserForced === true`，所以 `expandArtifactNamePattern` 里 `!isUserForced && …` 恒假 → **arch 永远不会被跳过**（默认 arch 也照常展开）。

### 因此：一个平台只能选一个架构（`arch` 单数，不是 `archs` 数组）

`NsisTarget.buildInstaller`（`NsisTarget.js:137`）：

```js
const primaryArch = archs.size === 1 ? archs.keys().next().value : null;
```

多架构 NSIS 会**合并成一个安装器**并把 `${arch}` 从文件名里删掉 → 产出文件名无法从请求推出，产物预览必然对不上。`GameBuildTarget.arch` 定为单数即可让映射变成全函数；macOS 的 `universal` 天然覆盖「两个架构都要」的场景。

### `dir` 目标的文件夹命名

`platformPackager.js:90-93`：`` `${buildConfigurationKey}${getArchSuffix(arch, defaultArch)}${platform === MAC ? "" : "-unpacked"}` ``，其中 `getArchSuffix` 在 arch 等于默认 arch（`defaultArchFromString(undefined)` = **x64**）时返回空串。

| | x64 | arm64 | universal |
| --- | --- | --- | --- |
| macOS | `mac` | `mac-arm64` | `mac-universal` |
| Windows | `win-unpacked` | `win-arm64-unpacked` | — |
| Linux | `linux-unpacked` | `linux-arm64-unpacked` | — |

### 面板深链：机制已存在，无需新建

`PanelService` 已有 `updatePayload(panelId, payload)` / `getPayload`，且 `SidebarPanelStack` 已把 `payload` 传进面板组件（`PanelComponentProps<TPayload>`）。现成先例：`modules/story-motion/index.tsx:29`。

Project 面板 id = `"narraleaf-studio:project"`（`modules/project/index.tsx:9`，未导出成常量）。缺的只是 `ProjectPanel` 去读 payload——它现在的 `activeSection` 是纯 `useState`（`ProjectPanel.tsx:20`）。

> **坑**：驱动 `activeSection` 的 effect 依赖必须写 `[payload]`（对象身份），不能写 `[payload.section]`——否则「进 assets → 返回概览 → 再点同一入口」时 section 值没变，effect 不会重跑。

### 图标预览：没有协议 URL，走 bytes → Blob → objectURL

`metadata.icons.<platform>.path` **不能**直接喂 `<img src>`。既有链路（`ProjectAssetsSection.tsx:100-126` + `modules/project/iconPreview.ts`）：

```ts
const bytes = await projectService.readProjectIcon(platform);          // Uint8Array | null
const preview = await createProjectIconPreview(bytes, icon.mediaType, icon.path);
<img src={preview.url} />
```

`.icns` 会先抽出最大内嵌 PNG（Chromium 不认 icns）。**objectURL 的生命周期是调用方责任**——替换与卸载都要 `URL.revokeObjectURL`，否则泄漏。

### 弹窗草稿必须提到 BuildService

「点图标 → 关弹窗 → 去项目设置改 → 回来接着构建」要求草稿活得比弹窗久。现在 selection 是 `openBuildDialog` 里的闭包变量（`BuildDialog.tsx:285`），关窗即失。草稿放 BuildService 服务级内存状态；**只有真正开始构建时才落盘 `BuildConfiguration`**，草稿本身不持久化。

### 其它约束

- `dialogs.show` 的 `buttons` 是 show() 时的静态快照，无 `updateDialog` API → footer 必须自绘进 `content`（`buttons: undefined`）。
- `DialogContainer` 的 `height` 传字符串会生成 `calc(600pxpx - 140px)` 静默失效 → **只传 number**。
- 左栏那个紧凑竖向 rail **没有现成组件**：`TabStrip` 是横向下划线且全仓无调用点，`ProjectPanelHome` 的 nav rows 是大卡片。rail 是新写的十几行。
- 其余控件全部复用 `Switch`/`Input`/`Select`/`Button`/`Badge`，并遵守现有高度与间距（`sizeStyles.sm = px-2 py-1 text-xs`、`text-2xs` = 11px、正文 300 字重、token 见 `tailwind.config.js` 与 `styles.css`）。

## web 带来的未决问题（恢复前必须先定）

web 目标不走 electron-builder，本方案的多处前提对它不成立：

- **无架构** —— 目标分区的架构下拉对 web 无意义。
- **无图标 / 无 fuses / 无签名** —— 标识分区的图标、内容与保护分区的加固与未签名说明都不适用。
- **无 `artifactName` 宏** —— 产物预览（本计划的核心「直观」卖点）对 web 无法沿用同一套推导。
- **`hostCanBuildTarget` 对 web 恒真** —— 目标分区「本机无法构建」的置灰逻辑要绕开它。

也就是说 web 行不是「第四个平台开关」，而是一个形状不同的东西。恢复时先定它长什么样，再动手。

## 分期实施

1. **弹窗骨架 + 预检**：双栏、状态点、自绘 footer、产物预览、`preflight` IPC。管线只做**抽出**（预检函数）与**上提**（artifactName 模板到 shared），零行为变更。
2. **就地编辑**：version、copyright、图标深链。复用 `ProjectService` 现有写入 API。
3. **架构 + dir 格式 + 压缩**：改 protocol、`normalizeBuildConfiguration`、`runGameBuild`。
4. **输出行为 + copyright 接线 + 镜像上下文提示**。

## 关键设计决策记录

- **footer 自绘而非用 `dialogs.buttons`** —— 静态快照无法响应预检状态。
- **预检不替代管线校验** —— 两边共用纯函数，`GameBuildManager` 保持权威（非 UI 调用方、跨宿主携带的旧配置仍须挡住）。
- **artifactName 模板上提 shared** —— 唯一事实来源，杜绝渲染端与 worker 端漂移。
- **一个平台一个架构** —— 见上「NSIS primaryArch」。
- **镜像不做成项目级** —— 避免与全局设置形成两个事实来源，只做上下文入口。
- **草稿不落盘** —— 只有 Start 才写 `BuildConfiguration`。

## 验收标准

- 版本号非法时，Start 在弹窗内即被阻断并跳到「标识」，而不是编译几十秒后 throw。
- 弹窗显示的产物文件名与实际产出逐字一致——**含 AppImage x64 → `x86_64` 这个特例**。
- 「文件夹」格式在本机产出 unpacked 目录，明显快于安装器路径。
- Apple Silicon 上可显式产出 macOS x64 / universal 产物。
- 旧 `.nlproj` 里的 `BuildConfiguration`（无 arch/compression 等字段）能正常读取并回退默认值。

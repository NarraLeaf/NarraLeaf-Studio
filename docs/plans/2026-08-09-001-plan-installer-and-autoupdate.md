---
title: "plan: Studio 安装器改版与 GitHub Release 自动更新"
type: plan
status: active
date: 2026-08-09
---

# plan: Studio 安装器改版与 GitHub Release 自动更新

> **进度（2026-08-09）：M0–M3 全部实现，五个 project typecheck 干净、vitest 无新增失败、
> style ratchet 未上升。真机验收做了能做的那一半，`§7` 逐条标了哪些是实测、哪些还欠。**
>
> 实测通过的：更新状态经 IPC 端到端（`checking → idle` 是**推**过来的，不是轮询）；
> 把版本临时降到 0.3.0 之后，启动检查真的从 GitHub 取到 v0.4.0 并给出 `manual` + 真实
> release URL；启动器版本号那行变成「更新到 0.4.0」；点它打开设置并**定位到「更新」那一项**；
> 关掉全部窗口后进程存活、日志写下 `[App] Last window closed; staying resident.`；
> `ManifestDPIAware true` 编译进 manifest（配了反向对照：不写这条就没有 `dpiAware`）。
>
> **验收里发现的一条产品缺陷（已修在本卡内）**：Windows 会把新注册的通知区图标默认收进
> 溢出区。于是「关掉所有窗口」在第一次看起来就是**应用消失了**——没有窗口、没有任务栏按钮、
> 图标在一个用户没理由去点开的箭头后面。现在第一次常驻时从托盘图标弹一次气球说明去向，
> 每个 profile 只弹一次（`app.trayResidencyNoticeShown`）。
>
> ---

> 今天的 Windows 安装包按下去就装完了：没有向导、不能选安装位置、窗口在高 DPI 屏上是糊的。
> 而 Studio 装好之后**永远不会知道自己有新版本**——`publish: null`，没有 `electron-updater`，
> 一行相关代码都没有。0.3.0 和 0.4.0 发出去了，装了 0.3.0 的人到今天还在用 0.3.0。
>
> 这两件事是同一张卡：**自动更新的安装体验就是安装器本身**。改成向导式而不同时把
> 更新时的静默安装接对，作者每次更新都会被弹一遍完整向导；反过来，不做更新，
> 把安装器修得再漂亮也只有第一次装的时候有人看见。

---

## 1. 现状（2026-08-09 核实）

### 1.1 安装器跑的是全套默认值

`electron-builder.yml` 的 `win:` 段只有三行（`target: nsis`、`icon`、`extraResources`），
**没有 `nsis:` 段**。于是四个症状各有出处：

| 症状 | 出处 |
|---|---|
| 立即安装、没有向导 | `oneClick` 默认 `true` |
| 不能选安装位置 | `allowToChangeInstallationDirectory` 只在 `oneClick: false` 下生效 |
| 界面简陋 | one-click 模式只有一个进度窗，MUI 的 header / sidebar 位图槽位根本不存在 |
| 低分辨率 / 发糊 | **NSIS 默认不是 DPI-aware**。`ManifestDPIAware` 在整个 `app-builder-lib` 里零命中（模板与 JS 两侧都查过），于是 Windows 直接按 96dpi 渲染再拉伸，125% / 150% 下整窗模糊 |

### 1.2 更新链路是零

- `electron-builder.yml:90` 是 `publish: null` → 不生成 `latest.yml`，也不往 resources 里写
  `app-update.yml`。
- `package.json` 没有 `electron-updater`。
- `.github/workflows/release.yml:121-125` 与 `:152` 只收 `*.exe *.dmg *.zip`。
- `app.autoCheckUpdates` 曾经是个没人读的死键，现在已在
  `src/shared/types/state/globalState.ts:319` 的 `RETIRED_GLOBAL_STATE_KEYS` 里。
  **要加设置得起新键名，不能复用它**——退役键是会被迁移逻辑主动删掉的。

### 1.3 assisted 模式的真实页序

从 `node_modules/app-builder-lib/templates/nsis/assistedInstaller.nsh` 读出来的实际顺序：

```
customWelcomePage(宏，默认没有) → 许可(有 license 文件才出现)
  → 安装模式「全机 / 仅我」(PAGE_INSTALL_MODE)
  → 目录(allowToChangeInstallationDirectory)
  → 进度(MUI_PAGE_INSTFILES) → 完成(含「运行 NarraLeaf Studio」勾选框)
```

两个白拿的好行为：

- **升级时许可页与目录页自动跳过**（`skipPageIfUpdated`），所以自动更新不会重新问一遍。
- 目录页选了 `D:\` 会被 `instFilesPre` 自动补成 `D:\NarraLeaf Studio`
  （`assistedInstaller.nsh:33-38`），不会把盘根灌满。

### 1.4 自定义 `.nsh` 的插入点

`NsisTarget.js:576` 把 `nsis.include` 指向的文件塞进 **script header**——也就是在
`!include "MUI2.nsh"` 和所有 `MUI_PAGE_*` 插入**之前**。这条是本卡好几项做法能成立的前提：
`ManifestDPIAware`、`MUI_*_STRETCH` 这些必须在页面宏展开前就 define，插入点晚一步就全部失效。

> ⚠ 别照抄 `installer.nsi:45` 那个 `customHeader` 的位置去想事情——那个宏是在页面**之后**
> 插入的，只能放 top-level 属性，放 MUI define 已经太晚。

---

## 2. 裁决

| # | 问题 | 结论 |
|---|---|---|
| D1 | 安装模式 | **默认按用户装，保留「全机 / 仅我」选择页**（`oneClick:false` + `perMachine:false` + `allowElevation:true`） |
| D2 | 更新策略 | **启动后台静默检查 + 非侵入提示，`autoDownload:false`**，用户点了才下 |
| D3 | 平台范围 | **只做 Windows 的真更新**；macOS 只提示「有新版本，去下载」 |
| D4 | nightly | **排除在自动更新之外**（理由见 §6.3） |
| D5 | 技术选型 | 继续用 NSIS，只是把它配置对。MSI/WiX 没有可用的 updater，Squirrel.Windows 已弃用 |

D1 的代价要写明白：**选了「全机」的用户，此后每次自动更新都会弹一次 UAC**。
`installer.nsi:99-121` 已经处理了这个路径（静默安装时先提权再解包），所以功能上是通的，
只是体验上会有提示框。选「仅我」的用户全程无提权。

---

## 2b. M0 — 常驻与退出（自动更新的地基）

自动更新要能在后台把 270MB 下完，前提是**关掉所有窗口不等于退出**。这一条不是附带需求，
它是更新体验成立的条件：作者关掉工程之后 Studio 必须还活着。

- `src/main/index.ts` 里那句「最后一个窗口关闭就 `app.quit()`」换成 `App.handleLastWindowClosed()`。
- `BaseApp` 注册一个**空的** `window-all-closed` 监听器。这不是占位符：Electron 在非 darwin
  平台上**没有**监听器时的内置行为就是退出，这个空监听器本身就是全部机制。
- **Windows / Linux**：`TrayManager` 建通知区图标，右键菜单三项——打开启动器 / 检查更新 / 退出。
- **macOS 不注册状态栏项**。Dock 已经表示「应用在跑但没有窗口」，再加一个状态栏图标是同一件事
  的第二种说法，而且 mac 用户会把它读成后台代理。常驻本身照旧，Dock 就是它的把手
  （`activate` 事件把启动器叫回来）。
- **一个安全网**：Windows/Linux 上托盘没建起来（Linux 没有 StatusNotifier host、图标资源缺失）
  就**退回旧行为直接退出**。既没有窗口又没有托盘项的进程，用户只能从任务管理器结束。
- **单实例锁**（`app.requestSingleInstanceLock`）：常驻之后，从开始菜单再点一次会起**第二个**
  Studio——两个托盘图标、两次更新检查、两个进程写同一份 `globalState.json`。
  **只在打包版启用**：dev 下 `dev-electron.js` 每次重建都重启进程，新实例可能在旧实例退干净之前
  抢锁失败，换来一个随机死掉的开发循环。
- **退出时正在更新**：`before-quit` 里用 `dialog.showMessageBoxSync` 问一句，默认按钮是「继续下载」。
  系统提示框而不是应用内弹窗，因为这一刻很可能一个窗口都没有——那正是后台下载所处的状态。
  同步，因为 `before-quit` 不能 await。
  ⚠ 取消退出时必须调 `BaseApp.cancelQuit()`：`quitting` 标志在本类自己的 `before-quit`
  监听器里已经置位了，留着它会让**此后整个会话**的窗口关闭守卫全部让路。

## 3. M1 — 安装器

### 3.1 配置

`directories` 加一行，`win:` 下加 `nsis:` 段：

```yaml
directories:
  output: build
  buildResources: project/installer   # ← 新增，理由见下

nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  perMachine: false
  allowElevation: true
  createDesktopShortcut: true
  createStartMenuShortcut: true
  shortcutName: NarraLeaf Studio
  runAfterFinish: true
  multiLanguageInstaller: true
  displayLanguageSelector: true
  installerLanguages: [en_US, zh_CN]
  installerHeader: project/installer/header.bmp
  installerSidebar: project/installer/sidebar.bmp
  uninstallerSidebar: project/installer/sidebar.bmp
  include: project/installer/installer.nsh
```

⚠ **`buildResources` 必须显式设置。** 它默认是 `build`，而本仓的 `directories.output`
也是 `build`，且 `/build/` 在 `.gitignore` 第 149 行。把 `installer.nsh` / 位图 / `messages.yml`
放进默认位置 = 放进构建输出目录 = 提交不进去、下次构建被清掉。
（顺带解释了 `builder-debug.yml` 里那两条一模一样的 `!build{,/**/*}`。）

`nsis:` 段与 `files` 无关，不受
[[electron-builder-files-trap]] 那条「平台块里写 `files` 会静默把整个仓库打进 asar」的影响。
**但这一轮改完仍然要看一眼 `build/builder-debug.yml` 的 `firstOrDefaultFilePatterns`**，
确认它开头不是 `**/*`——代价只有几秒，而这个坑是静默的。

### 3.2 `project/installer/installer.nsh`

```nsis
; 治「糊」。NSIS 默认 DPI-unaware，Windows 会把整窗位图拉伸。
ManifestDPIAware true

; DPI-aware 打开之后，对话框按系统 DPI 放大，而位图仍按 96dpi 的像素尺寸摆放。
; 不配 _STRETCH 的话症状会从「糊」变成「小且错位」——比原来更难看。
!define MUI_HEADERIMAGE_BITMAP_STRETCH "FitControl"
!define MUI_WELCOMEFINISHPAGE_BITMAP_STRETCH "AspectFitHeight"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP_STRETCH "AspectFitHeight"

!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend
```

electron-builder 在 assisted 模式下**不加欢迎页**，要靠 `customWelcomePage` 宏自己补
（`assistedInstaller.nsh:9-11`）。不补的话第一页就是「全机 / 仅我」，很突兀。

### 3.3 位图

- `header.bmp` 150×57、`sidebar.bmp` 164×314 是 MUI 的 1x 基准尺寸。
- 配了 `_STRETCH` 之后**按 3x 出图**（450×171 / 492×942），这样 100%~300% 全程都不糊。
- **24 位 BMP**，不要 32 位带 alpha——MUI 的 header 不支持 alpha，会出现黑边。
- 母版沿用 app icon 那一套（见 [[project-icon-system]]）。`project/build/` 下现在
  **没有**图标生成脚本（只有 `prepare-*` 系列），所以这一步要么手工出图并提交，
  要么顺手补一个生成脚本——本卡按**手工出图 + 提交**处理，生成脚本另开。

### 3.4 文案

`project/installer/messages.yml` + `assistedMessages.yml` 可以覆盖安装器的每一句话，
按语言分列。Studio 本来就有 en/zh 两套 catalog，安装器的中文不要新造词——
**「安装 / 卸载 / 目录 / 完成」这类词跟主界面 catalog 对齐**，不要一处叫「安装位置」
一处叫「安装目录」。

> 写文案前读 [[in-studio-help-system]] 的 §3a「陈述不叙述」。安装器尤其容易写成
> 「正在为您精心准备……」这种。

---

## 4. M2 — 发布管线

### 4.1 `electron-builder.yml`

```yaml
publish:
  provider: github
  owner: NarraLeaf
  repo: NarraLeaf-Studio
```

配上之后 electron-builder 会产出 `latest.yml` 和 `<installer>.exe.blockmap`，
并把 `app-update.yml` 写进包内 resources。

**`--publish never` 保持不动是对的**：`PublishManager.js:158-163` 里
`createUpdateInfoTasks` 只看 `event.isWriteUpdateInfo` 和 publish 配置是否存在，
**完全不受 `isPublish` 控制**。所以「本地生成 update info，由 release job 自己上传」
这条路是通的，不需要把 token 交给 electron-builder。

### 4.2 `release.yml` 的两处（**最容易漏的一步**）

```diff
       - name: Upload installers
         with:
           path: |
             build/*.exe
             build/*.dmg
             build/*.zip
+            build/*.yml
+            build/*.blockmap
```

```diff
-          mapfile -t files < <(find dist-artifacts -type f \( -name '*.exe' -o -name '*.dmg' -o -name '*.zip' \) | sort)
+          mapfile -t files < <(find dist-artifacts -type f \( -name '*.exe' -o -name '*.dmg' -o -name '*.zip' -o -name '*.yml' -o -name '*.blockmap' \) | sort)
```

漏了这一步，安装包照常发出去、Release 页面看着一切正常，
**而所有已装的 Studio 永远查不到更新**，且客户端只在日志里留一行 404。
这是整条链路里唯一一个「没有任何人会当场发现」的失败点。

### 4.3 发布纪律

- Release **不能是 draft**（updater 读不到），tag 必须与 `package.json` 的 `version` 逐字对应。
- 版本号仍然是三个 manifest 锁步（根 / `src/main` / `src/renderer/apps`），
  见 [[release-branch-push-rules]]。
- 现在的 `--generate-notes` 够用，但更新提示框要显示更新内容的话，
  Release body 就成了面向用户的文案而不只是 commit 列表——**这一条本卡不做**，
  提示框先只显示版本号与「查看更新说明」链接。

---

## 5. M3 — 应用内更新

### 5.1 主进程

新增 `src/main/app/application/managers/updateManager.ts`，与既有 manager 同构。

```ts
autoUpdater.autoDownload = false;          // 268MB，不能背着用户下
autoUpdater.autoInstallOnAppQuit = true;
```

暴露四个动作 + 一个状态流：`check` / `download` / `installNow` / `dismiss`；
状态 `idle | checking | available | downloading | ready | error`，下载中带进度。

安装用 `quitAndInstall(true /* isSilent */, true /* isForceRunAfter */)`。
**`isSilent` 是必须的**：改成 assisted 安装器之后，不传它会让每次更新都重走一遍完整向导。

### 5.2 更新源与镜像

GitHub Releases 在国内很慢，而仓里已经有一套下载源改写机制
（`managers/downloadRewrites.ts`，见 [[studio-settings-network-and-data]]：源分 source 与
rewrite 两类，还原 = 删键）。更新源应当接进那套，而不是再造一个设置。
运行时用 `autoUpdater.setFeedURL()` 覆盖即可。

> 这不违反 [[renderer-never-touches-network]]：electron-updater 全程在主进程里跑。

### 5.3 两次按下，不是一次

通知**宣布**更新，设置面板**开始**更新。通知的动作按钮打开设置并定位到更新那一项，
它自己不下载任何东西。

理由是这两件事是两个决定：知道有新版本是免费的，下 270MB 不是。第二个决定应该发生在
一个用户主动导航过去的界面上，版本号和进度就在眼前——而不是一个正要自动消失的 toast 上。

三个宿主面读同一份状态（`useUpdateState`），所以它们不可能对「正在下载吗」有分歧：

- **工作区**：`useUpdateOffer` 弹一条常驻通知，动作是「查看更新」。每个窗口只弹一次。
  `ready` 不再宣布——安装包已经在盘上说明作者按过下载，他已经见过那个面板了。
- **启动器**：侧栏版本号那一行换成「更新到 X」，点击打开面板。
- **托盘**：「检查更新…」直接打开同一个面板。

### 5.4 界面

设置有八个分类（general / appearance / editor / workspace / shortcuts / versionControl /
network / data，见 [[settings-shortcuts-category]]）。更新是**动作密集**而不是键值型，
跟 `CacheInventoryPanel` / `DownloadSourcesPanel` / `SettingsTransferPanel` 是一类：

- 新增 `src/renderer/apps/settings/panels/SoftwareUpdatePanel.tsx`，挂在 **`general`** 下。
  **不新增设置分类**——加一个分类要动五处，而这里没有那个必要。
- 两个新设置键（新键名，不复用退役的 `app.autoCheckUpdates`）：
  是否启动时检查、更新源（如果 5.2 接进 downloadRewrites 就不需要第二个）。
- 非侵入提示：用既有的提示组件，不要新造弹窗。
  **弹窗一律走 `useWindowOverlayHost`，不许 portal 到 body**（见 [[dialog-overlay-layer]]）。

界面按 [[design-system-is-mandatory]] 与 [[ui-style-constraints]] 做：
minimal chrome、不写解释性文字、复用既有组件。

### 5.5 macOS 的降级路径

同一个 panel，在 macOS 上只做「查询最新版本号 → 比对 → 给 Release 页面链接」，
不调 `autoUpdater`。理由见 §6.1。**不要把它做成一个灰掉的按钮**——
在唯一能用的宿主上够不着的功能，是 [[code-signing-round]] 记过的老病。

---

## 6. 硬约束

### 6.1 macOS 现在做不了自动更新

两个各自独立的拦路虎：

1. **Squirrel.Mac 要求有效代码签名**，而 Studio 全平台未签名
   （`release.yml:20-21` 明写这件事）。未签名的 app 上 electron-updater 直接报
   `Could not get code signature for running application`。
2. **mac 目标只有 `dmg`**（`electron-builder.yml:112`），而 updater 的 mac 通道要 `zip`。

第 2 条是一行配置，第 1 条不是。所以 D3 定「mac 只提示」，真更新等 Studio 自身签名那一轮。

### 6.2 Windows 未签名可以自动更新

electron-updater 下载的文件不经浏览器、不带 MOTW，所以不触发 SmartScreen。
**浏览器首次下载仍然会被拦**——那是代码签名的问题，不在本卡范围，
但值得在 Release 说明里给一句话。

### 6.3 nightly 套不进 electron-updater 的通道模型

`origin/nightly` 上的 `nightly.yml` 发的是**滚动 tag `nightly`** 的 prerelease，
而 updater 的通道模型是 `latest.yml` / `beta.yml` / `alpha.yml`**一版一文件**。
硬接的话要给 nightly 也发 `alpha.yml` 并让客户端能切通道——**本卡不做**。
nightly 用户继续手动装。

### 6.4 268MB 的包，差分不是可选项

`.blockmap` 差分下载必须有。但**实际能省多少要实测**：`asarUnpack: node_modules/**/*`
意味着大部分内容是散文件而不是一个 asar，NSIS 的 7z 块压缩之下，
patch 版本之间的差分表现要拿两个真版本比一次才知道。
**验收里要有这条数字**，不能只断言「差分开了」。

### 6.5 `perMachine` 与提权

见 §2 的 D1 说明。另外 `installer.nsi:99-121` 那段静默提权逻辑只在
`oneClick:false` 且非 `INSTALL_MODE_PER_ALL_USERS` 时编译进去——正好是本卡选的组合，
不需要额外处理。

---

## 7. 验收

安装器这半边**必须真机看**（[[orchestrator-visual-acceptance]]），而且要在
**高 DPI 屏上截图对比改前改后**——`ManifestDPIAware` 那条改动的全部价值就在那张图里。

| # | 断言 | 手段 | 状态 |
|---|---|---|---|
| A1 | 向导六页依次出现，页序与 §1.3 一致 | 真机走一遍 | **欠**（需要真打一次包） |
| A2 | 150% 缩放下文字与位图都不糊、不错位 | 截图对比 | **欠**（`ManifestDPIAware` 已验证进 manifest，观感未看） |
| A3 | 目录页改到 `D:\Temp\NLS` 后真的装在那里 | 装完看盘 | **欠** |
| A4 | 「仅我」路径全程无 UAC | 真机 | **欠** |
| A5 | 覆盖安装时许可页与目录页被跳过 | 装两次 | **欠** |
| A6 | 包内有 `resources/app-update.yml` | 解包看 | **欠** |
| A7 | `build/` 下产出 `latest.yml` + `.exe.blockmap` | 构建产物 | **欠** |
| A8 | Release 上真的挂了 `latest.yml` 与 `.blockmap` | `gh release view` | **欠** |
| A9 | 旧版本能查到、能下、能装，装完版本号真的变了 | **必须端到端做一次**，用两个真 tag | **欠** |
| A10 | 差分下载生效，且记下省了多少 | updater 日志 + 字节数 | **欠** |
| A11 | mac 上不调 autoUpdater，只给链接 | mac 侧真机或代码复核 | 代码复核 ✓ |
| A12 | NSIS 层能编译，欢迎/目录/进度/完成四页都在，两个位图与两种语言都进去了 | 用生成脚本形状的 `.nsi` 跑 makensis | ✓ |
| A13 | `ManifestDPIAware true` 真的写进 exe 的 manifest | 编译两份对拍：不写这条就没有 `dpiAware` | ✓ |
| A14 | 更新状态是**推**过来的真实数据，不是轮询也不是动画 | CDP 里挂监听器，实测收到 `checking → idle` | ✓ |
| A15 | 版本比较走真实 GitHub API | 把版本临时降到 0.3.0，实测得到 `manual` + v0.4.0 的真实 release URL | ✓ |
| A16 | 启动器那行 → 打开设置并定位到「更新」 | CDP 点击 + 截图 | ✓ |
| A17 | 关掉所有窗口后进程存活 | 关光窗口后 CDP target 为空、browser 仍在、日志有 `staying resident` | ✓ |
| A18 | 首次常驻只提示一次 | `app.trayResidencyNoticeShown` 落盘为 true | ✓ |

**A9 仍然是这张卡的唯一真判据**，而它还没做。上面打勾的十几条证明的是「零件是对的」，
不是「更新链路通了」——更新链路的失败模式全部是「看起来一切正常」。
A1–A10 都要等一次真正的 `electron-builder --win --x64` 与两个真 tag。

## 7b. 交接：合并后第一件事

`electron-updater` 是**新增的运行时依赖**。合并 develop 之后，任何检出在跑起来之前都要
`yarn install` 一次——否则打包好的 main 进程会在 `require("electron-updater")` 上当场失败。
CI 每次都是全新安装，所以只有本地检出会踩到这个。

---

## 8. 不在本卡范围

- **Studio 自身的代码签名**。它是 mac 自动更新和「浏览器下载不被 SmartScreen 拦」的前提，
  但是一张独立的卡。[[code-signing-round]] 那轮签的是**用户的游戏产物**，不是 Studio。
- **Linux / AppImage**：`release.yml` 的 matrix 现在根本不构建 Linux。
- **更新说明的产品化**：Release body 现在是 `--generate-notes` 的 commit 列表。
- **通道切换（stable / nightly）**：见 §6.3。

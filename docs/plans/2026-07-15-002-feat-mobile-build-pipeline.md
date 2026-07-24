---
title: "feat: 移动端（Android / iOS）构建管线"
type: feat
status: in-progress
date: 2026-07-15
---

# feat: 移动端（Android / iOS）构建管线

> **一句话总览**：移动端 = 把 Web 导出装进自研的原生 WebView 壳。壳在新仓库
> NarraLeaf/Studio-Shell 里用 Kotlin/Swift 各写一个，由该仓库的 CI 预构建成
> **模板产物**（未签名 APK / 未签名 .app），以 npm 包形式随 Studio 分发；
> 用户构建时 Studio 侧用**纯 TS 重打包（repack）**注入游戏载荷并产出安装包，
> **全程离线、零用户侧工具链**。
>
> **关联**：[2026-07-15-001（构建弹窗重构）](2026-07-15-001-feat-production-build-dialog.md)
> 因 web target 在途而 blocked；本计划的类型改动与它落在同一批文件上。
> **依赖顺序：web target（`GameBuildPlatform` 加 `"web"` 那批工作区改动）必须先
> commit，本计划的实现才能开始。**

## 1. 目标与非目标

### 首轮目标（本计划 M1–M3）

- 构建目标新增 `android` 与 `ios`，从构建对话框可选。
- Android 产出**可直接安装**的 APK（自动生成的本地 debug 级自签名身份；无任何签名
  配置 UI）。
- iOS 产出**未签名 IPA**（供用户用自己的重签工具旁加载，或后续接签名流程）。
- 用户构建过程不联网、不要求安装 JDK / Android SDK / Gradle / Xcode /
  CocoaPods 中的任何一样。

### 明确的非目标（后续批次，见 §10 里程碑）

- release 签名配置 UI（Android keystore 管理、iOS 证书/描述文件）。
- AAB / Play Asset Delivery / App Store 上架链路。
- 移动端资产加密（独立里程碑 M4，见 §8；首轮只预留壳内拦截点）。
- 移动原生桥 v2（原生文件存储、返回键语义、方向锁定的运行时联动）。
- 壳内原生插件扩展能力（逃生舱 = 未来提供 gradle / Xcode 工程导出格式，那条路
  才要求用户自备工具链）。

## 2. 硬约束（所有实现批次都必须遵守）

1. **离线**：用户侧构建不得有任何网络请求、不得触发任何"首次下载工具链"。所有
   依赖要么在 Studio 安装包里，要么在 npm 依赖树里随 Studio 一起装好。
2. **法务**：Android SDK 组件（build-tools、aapt2、apksigner 二进制、platform
   jar 等）受 Android SDK 服务条款约束，**禁止再分发**——不得打进 Studio 或
   npm 包，**不进任何分发物**。CI runner 为 SDK 的主落点（GitHub 托管 runner
   预装，属于 GitHub 与 Google 的授权范围）：模板构建与验证 oracle
   （apksigner / aapt2 / zipalign）都跑在那里；Studio 与 Studio-Shell 两仓都
   可以为此建 GitHub Actions workflow。开发者本机自装 SDK 仅作辅助排障
   （开发者自行接受 Google ToS，不涉及再分发）。（2026-07-15 拍板修订）
   可再分发的例外：Temurin JDK（后续 AAB 批次若
   需要 jlink 裁剪版 JRE）、bundletool（Apache-2.0）、AOSP apksig **源码**
   （Apache-2.0，自行编译的产物可分发；build-tools 里的成品二进制不可以）。
3. **技术栈**：Studio 侧新增代码全部为 TS，跑在现有 utilityProcess worker 模式
   里；Kotlin/Swift 只存在于 Studio-Shell 仓库，用户与 Studio 运行时永远不接触
   这些工具链。
4. **保密（HARD RULE 延续）**：Studio 源码与本文档不得披露资产保护机制的任何
   实现细节。壳仓库同样不得包含保护机制代码——只允许一个通用 decoder 接口
   （§8）。
5. **i18n**：所有新 UI 文案走 `src/shared/i18n`（en + zh 双 catalog）；涉及
   lib/ui-editor 的 i18n 改动后必须 `yarn build`。
6. UI 文案不用 ALL-CAPS，不向用户展示内部 id。

## 3. 路线决策记录（为什么是 repack，不是别的）

| 路线 | 结论 | 原因 |
| --- | --- | --- |
| Capacitor 壳 + 用户侧 gradle/Xcode | ❌ 否决 | 把 Gradle、SDK、CocoaPods 拖到用户侧，违反约束 1/2；serving 层的价值反正要在壳里重做 |
| Tauri 2 mobile | ❌ 否决 | 引入整条 Rust 工具链 |
| TWA / Bubblewrap | ❌ 否决 | 仅 Android、要求在线托管，与离线分发目标不符 |
| React Native 等 | ❌ 否决 | 需重写渲染层 |
| **自研极简壳 + CI 预构建模板 + 用户侧 TS repack** | ✅ 采用 | 三条硬约束同时满足；Godot 安卓导出（预构建模板 APK + 重打包）是同构先例 |

repack 之所以成立，根本前提是：**游戏没有任何原生代码**。渲染层 bundle 桌面/
Web/移动字节一致，只依赖 `window.__NLS_GAME_RUNTIME__` 上的
`GameRuntimePreloadBridge`（`src/shared/types/gameRuntime.ts:126`，13 个方法，
Web 实现见 `src/runtime/web/web.ts`，151 行）。因此每个项目的移动壳除了
appId、显示名、版本、图标、方向和 `www/` 载荷之外完全相同——不需要"构建"，
只需要"替换与补丁"。

由此还得到两个免费结论：

- **无 arch 维度**。WebView 壳 ABI 无关，无 NDK、无 universal 问题。
  `GameBuildTarget.arch` 对移动平台不适用（与 web 相同处理）。
- **iOS repack 在任意主机可行**（v1 不签名，纯 zip 操作）。后续签名批次才把
  已签名 ipa 限制到 macOS 主机（`codesign` 是 macOS 自带命令）。

## 4. 仓库组织与产物流

> **仓库已创建**：`https://github.com/NarraLeaf/Studio-Shell.git`（2026-07-16，空仓）。

```
NarraLeaf/Studio-Shell（新仓库，Kotlin + Swift）
  └─ CI（build-shells.yml，仿 NarraLeaf-Encryption 的 build-native.yml）
       ├─ ubuntu runner + 预装 Android SDK → template-android.apk（未签名）
       └─ macos runner + Xcode           → template-ios.app.zip（未签名）
       ↓ artifacts
  scripts/pull-prebuilds.js（照抄 ../NarraLeaf-Encryption/scripts/pull-prebuilds.js
  的 gh CLI 模式）组装 → npm publish：@narraleaf/studio-shell
       ↓ 版本化 npm 依赖
NarraLeaf-Studio
  └─ package.json 依赖 @narraleaf/studio-shell
  └─ project/build/prepare-mobile-shell.js（仿 prepare-preview-runner.js）
       → resources/mobile-shell/…，经 electron-builder.yml 的 extraResources
         打进 Studio 安装包；dev 模式直接从 node_modules 解析
       ↓
  GameBuildManager 第三分叉（复用 shell:"web" 编译产物）
       ↓ GameBuildWorkerMobileJob
  buildWorker：纯 TS repack → <name>-<version>-android.apk / -ios.ipa

NarraLeaf/NarraLeaf-Encryption（既有私有仓，本轮不动）
  └─ 后续批次新增 android(.so) / ios(静态库) 原生产物，接入壳的 decoder 接口
```

模式复用点（这是"经验复用"的确切含义）：

- **CI 矩阵 → artifact → pull 脚本 → npm 发布**：照
  `../NarraLeaf-Encryption/.github/workflows/build-native.yml` +
  `scripts/pull-prebuilds.js` 的结构搬，把 nlcrypto.node 换成两个壳模板。
- **Studio 消费方式**：与 `@narraleaf/encryption`（package.json 固定版本依赖）
  相同；模板落进 `resources/` 的方式与 preview-runner（
  `project/build/prepare-preview-runner.js` + `electron-builder.yml`
  extraResources）相同。
- **仓库可见性**：Studio-Shell 建议可以公开（壳内无任何保护机制代码，见约束 4），
  但公开与否不影响管线——pull 脚本经 gh CLI 认证，私有也照常工作。

## 5. Studio-Shell 仓库规格

### 5.1 共同契约（两个壳都要满足）

- **装载物**：壳内嵌一个 `www/` 目录（= Studio 的 web 编译产物：index.html、
  web.js、renderer.js/css、plugin-api/、pack.json、assets/…），以及一个
  `shell-config.json`（repack 时注入，见 5.4）。
- **本地 serving**：通过自定义 scheme / 请求拦截把 `www/` 以稳定 origin 提供给
  WebView。**必须实现**：
  - HTTP Range（音视频 seek 的生死线；桌面 `nlgame://` 已踩过同一坑——
    immutable 缓存 + Range + LRU 的经验直接迁移）；
  - 流式读取大文件（不整读内存）；
  - 正确的 Content-Type 推断。
- **桥**：v1 直接复用 `web.js`（IndexedDB 存档）。壳只需保证 WebView 环境让
  web.js 正常工作（自定义 scheme 下 IndexedDB 可用、fetch 相对路径可达）。
  原生桥 v2（原生文件存档等）是后续批次，届时以壳内注入的 JS 接口替换
  web.js 的实现层。
- **调试开关**：release 构建关闭 WebView 检查（Android 不开
  `setWebContentsDebuggingEnabled`；iOS 不开 `isInspectable`——注意该 API 需
  iOS 16.4+，低于则 `#available` 守卫）。模板 CI 同时出
  debug 变体供 Studio Dev 场景与实机排障（是否随 npm 包发布 debug 变体：发布，
  但 Studio 只在开发模式使用）。
- **音频/媒体解锁**（2026-07-15 拍板，§11.3 的解）：壳直接关闭自动播放的手势
  门槛——Android `WebSettings.mediaPlaybackRequiresUserGesture = false`；iOS
  `WKWebViewConfiguration.mediaTypesRequiringUserActionForPlayback = []` 且
  `allowsInlineMediaPlayback = true`（否则视频强制走原生全屏播放器）。若
  Phase 0 实测发现 WebAudio 路径仍 suspended，备选 = 壳注入首触 resume() 垫片
  （挂 shell-config 开关），作 M1 机动项而非默认实现。
- **decoder 接口**：serving 层读取资产字节前经过一个
  `ContentDecoder`（默认恒等实现）。接口只暴露"字节进字节出/流进流出"的通用
  形状，不含任何机制语义。后续私有库以原生产物形态替换默认实现。
- **零第三方依赖**：Android 壳不引 androidx.webkit 之外的库（能不引就不引，
  目标是模板体积与供应链都最小）；iOS 壳只用系统框架（WebKit）。

### 5.2 Android 壳（Kotlin）

- 单 Activity + WebView；`shouldInterceptRequest` 实现 5.1 的 serving 契约。
- minSdk 建议 26（Android 8.0，覆盖绝大多数在役设备；确切值在壳仓库首个 PR 里
  定稿并写进模板 manifest）。
- 模板以**占位符身份**构建：包名 `com.narraleaf.shell.placeholder`、label、
  versionCode/versionName 均为占位值，图标为固定文件名的普通 mipmap PNG
  （**不使用**需要 aapt2 编译的 adaptive icon XML 引用新增资源的形态——
  adaptive icon 的 XML 在模板期定死，repack 只替换它引用的 PNG 字节）。
- 全屏/沉浸模式默认开启；方向由 `shell-config.json` 在运行时
  `setRequestedOrientation`（避免 repack 补丁 manifest 属性）。

### 5.3 iOS 壳（Swift）

- 单 ViewController + WKWebView；`WKURLSchemeHandler` 实现 serving 契约
  （Range 必须支持——AVPlayer 支撑的媒体请求没有 Range 就没有 seek）。
- 模板产物是未签名 `.app`（CI 上 `xcodebuild` 出 Release-iphoneos 且
  `CODE_SIGNING_ALLOWED=NO`），zip 保存以保留可执行权限位。
- 图标用 **Info.plist 的 CFBundleIcons + 普通 PNG 文件**（不是 Assets.car）：
  repack 只替换 PNG 与 plist 字段。旁加载/开发场景完全够用；App Store 提交
  对 asset catalog 的要求是后续批次的已知开放问题（§11）。
- 方向白名单、显示名、bundle id、版本均为 Info.plist 字段（纯文本 plist，
  repack 直接改写）。

### 5.4 模板包（npm: @narraleaf/studio-shell）布局

```
package.json            # 版本 = 模板版本，Studio 锁定消费
android/template.apk    # 未签名，占位身份
android/template-debug.apk
ios/template.app.zip    # 未签名
ios/template-debug.app.zip
manifest.json           # 机器可读契约：占位符值、minSdk、图标槽位
                        # （文件名/尺寸清单）、shell-config.json 的 schema 版本
```

`manifest.json` 是 Studio 侧 repack 器与模板之间的**版本化契约**：repack 器
启动时校验 schema 版本，不匹配即报"Studio 与壳模板版本不兼容"，防止静默错配。

`shell-config.json`（repack 时写入模板内约定路径）：方向、初始背景色（与
webShell 的 pre-boot 背景同源）、以及日后扩展的壳行为开关。壳启动时读取。

### 5.5 CI 与发布（build-shells.yml）

- 触发：push main + workflow_dispatch（同 build-native.yml）。
- ubuntu job：`gradle assembleRelease/assembleDebug`（SDK 用 runner 预装的，
  **不缓存进产物**）→ 校验 APK zip 结构 → upload-artifact。
- macos job：`xcodebuild ... CODE_SIGNING_ALLOWED=NO` → zip .app →
  upload-artifact。
- 校验步骤（CI 内，SDK 合法可用）：`apksigner`/`aapt2 dump` 断言占位符位置、
  `unzip -l` 断言图标槽位齐全——这些断言就是 Studio 侧 repack 器的护栏。
- 发布：`pull-prebuilds` 拉齐两平台产物 → 生成 manifest.json →
  `npm publish`。

## 6. Studio 侧管线改动

### 6.1 类型（src/shared/types/gameBuild.ts）

- `GameBuildPlatform` 增加 `"android" | "ios"`；引入
  `GameBuildMobilePlatform`，`GameBuildDesktopPlatform` 保持 Exclude 派生。
- formats：`android: ["apk"]`，`ios: ["ipa"]`（v1 各一种；后续批次加 aab /
  xcodeproj）。`GAME_BUILD_FORMATS_BY_PLATFORM` 同步。
- `arch` 对移动平台忽略（同 web 的注释处理）。
- `hostCanBuildTarget`：android/ios 恒真（v1 无签名，纯 zip/补丁操作跨平台；
  签名批次再收紧 ios 的已签名格式到 macOS）。
- `predictGameBuildArtifacts`：新增移动命名，与 web 同风格：
  `<artifactBaseName>-<version>-android.apk`、`<...>-ios.ipa`（helper 函数与
  webExportDirName 并列，双端复用防漂移）。

### 6.2 编译层（复用，微调）

- 移动目标复用 `shell: "web"` 的 `compileGameRuntimeArtifact` 产物。web 与移动
  目标同时勾选时**只编译一次**（staging-web 输出双用）。
- `webShell.ts` 增加变体参数：移动变体的 index.html 加
  `viewport-fit=cover`（安全区），其余不动。v1 桥仍是 web.js。
- 加密：M4 之前与 web 相同——移动目标 + `encryptAssets` 开启时输出同款
  console 提示（"资产保护不适用于移动导出"），载荷明文。提示文案写成
  "暂不适用"的口径，M4 落地后此分支切换为桌面同源的密文 pack 路径（§8）。

### 6.3 Worker（protocol.ts / runGameBuild.ts + 新模块）

新增 job 类型（与 `web` job 并列，`targets`/`web`/`mobile` 三块）：

```ts
type GameBuildWorkerMobileJob = {
    /** 编译好的静态站点目录（与 web job 同源）。 */
    sourceDir: string;
    /** resources/mobile-shell 下的模板根（含 manifest.json）。 */
    templateDir: string;
    appId: string;
    productName: string;
    version: string;          // versionName；versionCode 由版本派生（语义见实现）
    orientation: "landscape" | "portrait" | "auto";
    icons?: { android?: string; ios?: string };  // 绝对路径，管理器预解析
    android?: { format: "apk"; outputName: string };
    ios?: { format: "ipa"; outputName: string };
};
```

repack 步骤（各自独立模块，纯函数式、可单测）：

**Android（buildWorker/mobile/repackApk.ts）**
1. 以模板 APK 为基（不解压到磁盘，zip 条目级操作）；
2. 注入 `assets/www/**`（游戏站点）与 `shell-config.json`；
3. 替换图标 PNG 条目（按 manifest.json 的槽位清单）；
4. 补丁二进制 AndroidManifest.xml：包名、label、versionCode/versionName
   （string pool 全量重建，不走等长 hack——健壮优先）；
5. 补丁 resources.arsc 的 package name 字段（定长 UTF-16 槽，原地写）；
6. 写出时保证 API 30+ 约束：resources.arsc 不压缩且 4 字节对齐、其余未压缩
   条目 4 字节对齐（TS zip writer 自己保证，等价 zipalign）;
7. v2 签名：本地生成一次性的 debug 级 RSA 自签名身份（存 userData，项目间
   复用，保证覆盖安装不换签名），按公开的 APK Signature Scheme v2 规范用
   node:crypto 签名（证书 DER 构造允许引入纯 JS 依赖，如 node-forge）。

**iOS（buildWorker/mobile/repackIpa.ts）**
1. 以 template.app.zip 为基，重排为 `Payload/<Name>.app/**` 结构；
2. 注入 `www/**` 与 `shell-config.json`；
3. 改写 Info.plist：CFBundleIdentifier / CFBundleDisplayName /
   CFBundleShortVersionString / CFBundleVersion / 方向白名单 / 图标文件名；
4. 替换图标 PNG；
5. zip 成 `.ipa`（保留可执行权限位——全程条目级搬运、不落盘解压，权限位
   随条目元数据保真，Windows 主机同样成立）；
6. 不签名，产物即未签名 IPA。

**GameBuildManager**：目标归一化处加移动分支；模板目录解析走
`resolveResource`/node_modules 双轨（同 `resolveElectronDistDirForApp` 的
isPackaged 分叉）；构建前校验模板 manifest.json 的 schema 版本；appId 复用
`deriveGameAppId`（Android 包名合法性比 reverse-domain 更严——数字开头段等
边角在归一化里处理并警告）。

### 6.4 UI 与配置

- 构建对话框平台清单加 Android / iOS（注意与
  [2026-07-15-001](2026-07-15-001-feat-production-build-dialog.md) 的重构
  合流：若弹窗重构先行，则在新结构上加；否则在现 BuildDialog 上最小接入）。
- `metadata.icons` 扩展 `android` / `ios` 键（Project▸资源沿用现有图标配置
  UI 模式；缺失 = 警告 + 模板默认图标，与桌面行为一致）。
- 方向作为项目级设置（默认 landscape）。
- 所有新文案进 i18n en+zh。
- 控制台进度沿用 Build 频道现有流式模式。

## 7. 签名与安装的现实边界（写给未来批次）

- v1 Android 的 debug 级自签名**不是**发布签名；上架 Play 前需要 release
  keystore 配置 UI + AAB（bundletool + jlink JRE，均可再分发、可离线 vendor）。
- iOS 设备安装永远需要签名身份（用户 Apple 账号），这是苹果分发模型的物理
  边界；签名批次的方案是 macOS 自带 `codesign` + 用户证书/描述文件，Xcode
  只在上传 App Store 时需要。
- 未签名 IPA 的定位：交给用户既有的重签/旁加载工具链，或后续 Studio 签名
  批次的输入。

## 8. 加密（里程碑 M4；首轮 M1–M3 只留门）

首轮范围内壳只实现恒等 `ContentDecoder`（§5.1），移动导出与 web 一致为明文。
M4 把它变成真实防护，跨三个仓库：

- **NarraLeaf-Encryption（私有仓）**：产出 Android（NDK 交叉编译 .so）与 iOS
  （静态库 / xcframework）原生库——即扩展现有 build-native.yml 的目标矩阵，
  沿用同一套 artifact → pull 的发布纪律。内部实现与接入细节只在私有仓内
  文档化；本仓库与 Studio-Shell 仓库不描述其任何机制。
- **Studio-Shell**：壳以原生库替换恒等 decoder。模板 CI 需要拉取私有仓产物
  （跨私有仓 artifact 的授权方式在 M4 首个 PR 里定稿）；接口边界不变，壳的
  公开代码始终只见 `ContentDecoder` 的通用形状。
- **Studio**：移动编译分叉从"明文 + 提示"切换为与桌面同源的密文 pack 路径
  （复用现有 sealing 链路与密钥解析）；§6.2 的提示文案随之更新。
- **验收**：开启资产保护的项目在双端实机可玩；解包 APK / IPA 得到的资产为
  密文；关闭保护的项目行为与 M2/M3 一致。
- **威胁模型对齐桌面**：目标是把攻击成本从"解压即得"抬到"逆向原生代码/
  内存 dump"级别，不追求绝对防御；配合 5.1 的调试开关关闭。iOS 侧 App Store
  分发的壳可执行体另有系统级加密，逆向成本额外抬升。

## 9. 测试与验收

- **Studio-Shell CI**：apksigner / aapt2 / unzip 断言模板结构契约（占位符、
  图标槽、arsc 位置）；模拟器 smoke（Android emulator 跑一个最小 www 载荷、
  断言页面加载与 Range 响应）尽力而为，首版可 manual。
- **Studio 单测**：repack 器全部纯函数化，用模板 fixture（随
  @narraleaf/studio-shell dev 依赖进来的真模板）做金样测试：补丁后的二进制
  XML 可被解析器读回、arsc 补丁幂等、zip 对齐断言、（Android）签名块结构
  自校验。
- **端到端验收（M2/M3 完成定义）**：
  - M2：样例项目 → 构建对话框选 Android → 产出 APK → 实机安装 → 游戏可玩
    （含音视频 seek、存档写读、重进游戏存档仍在）。
  - M3：同项目产出未签名 IPA → 第三方重签工具旁加载 → 实机可玩同清单。
- **Phase 0 前置验证（可立即做，不依赖任何新代码）**：现有 web 导出丢进
  手机浏览器/裸 WebView，实测渲染、触控、音频解锁、视频 seek——结果校准
  M1 壳实现的优先级。

## 10. 里程碑

| # | 内容 | 仓库 |
| --- | --- | --- |
| M0 | Phase 0 实机验证（web 导出直测）+ 壳仓库骨架、minSdk 等参数定稿 | Studio-Shell |
| M1 | 双壳实现 + build-shells.yml + pull 脚本 + @narraleaf/studio-shell 首发 | Studio-Shell |
| M2 | Studio 类型/编译复用/worker repack（Android）/UI 最小接入 → debug APK 端到端 | Studio |
| M3 | iOS repack → 未签名 IPA 端到端 | Studio |
| M4 | 移动端资产加密接入（私有仓原生库 → 壳 decoder → Studio 密文 pack），见 §8 | Encryption + Studio-Shell + Studio |
| M5+ | 原生桥 v2、release 签名、AAB、商店化、工程导出逃生舱 | 各仓 |

M2 开始的前置条件：web target 改动已 commit（见文首关联说明）。

## 11. 开放问题

1. **iOS App Store 图标**：asset catalog（Assets.car）只能由 actool 产出，
   离线 repack 做不了。候选：上架路径要求用户过一次 Xcode；或 CI 按需代编；
   或维持 plist 图标直到苹果验证卡住。上架批次前定夺。
2. **Android 返回键**：默认行为杀 Activity。v1 接受；桥 v2 定义语义
   （映射到游戏内菜单/最小化）。
3. **音频自动播放**：双端 WebView 需用户手势解锁；开场自动 BGM 的表现待
   Phase 0 实测，可能需要壳内首触解锁垫片。
   → **已决（2026-07-15）**：壳级配置解锁为主（写进 §5.1 契约），首触 resume
   垫片降级为 Phase 0 实测后的机动备选。
4. **模板↔Studio 版本纪律**：manifest.json schema 版本已挡住错配，但
   npm 版本升级节奏（模板改动是否总是伴随 Studio 发版）待 M1 后回顾。
5. **versionCode 派生规则**：从 semver 派生单调整数的具体公式在 M2 实现时
   定稿（预发布版本的处理要明确）。
   → **已决（2026-07-15）**：`versionCode = max(1, major*1_000_000 +
   minor*1_000 + patch)`，约束 minor/patch ≤ 999、major ≤ 2099（刻意采纳
   Google Play 的 2_100_000_000 上限为 M5+ 预留；OS 实际上限是 Int32.max），
   越界 → preflight error（`version-uncodable`）；预发布版本与正式版共享同一
   versionCode 并给 warning（同 code 同签名允许覆盖安装，侧载无痛；「预发布
   严格小于正式版」是 Play 上架纪律，留给 M5+ 签名批次）。实现放
   `src/shared/types/gameBuild.ts`（`deriveAndroidVersionCode`），双端共享防漂移。
6. **触屏适配清单**（hover 态、字号、安全区 letterbox）：产品级 QA 项，
   Phase 0 输出清单，另立计划。

## 12. 实施计划（2026-07-15 定稿；状态见 §12.0）

> 经评审确认。已拍板：①Studio 与 Studio-Shell 两仓均建 GitHub Actions
> workflow，SDK oracle 主落点在 CI（§2.2 已修订）；②orientation 为项目级设置，
> 落 `ProjectAppConfiguration.mobile.orientation`（默认 landscape）；
> ③Studio-Shell 仓库 LICENSE = MPL-2.0（与 Studio 一致）；④iOS repack 把
> `Payload/Shell.app` 重命名为 `Payload/<ProductName>.app`（CFBundleExecutable
> 保持模板值）；⑤versionCode 公式与音频解锁见 §11.3/§11.5 的已决标注。

### 12.0 实施状态（截至 2026-07-16 晚：M2 完成，仅欠实机安装）

**本轮（2026-07-16 晚）完成并推送 develop**：S1–S4 壳仓库全绿并发布
`@narraleaf/studio-shell@0.1.0`；Studio 侧 **A2 / A6 / B1 / A7 全部落地**。

| 项 | 提交 | 备注 |
| --- | --- | --- |
| A2 ✅ | `e40657f` | devDependency 精确锁定 + prepare-mobile-shell.js + resolveMobileShellDirForApp 双轨 + 模板加载/校验；**打包实测**：模板仅 1 份（`resources/mobile-shell/`），不在 asar/asar.unpacked |
| A6 + B1 ✅ | `be4e3f0` | protocol mobile job（双端一体）、runMobileRepack（fs 层）、manager 分支、图标缩放、身份持久化、临时守卫已移除 |
| A7 ✅ | `093e397` | Android 进 DIALOG_PLATFORMS；5 条新 preflight code；orientation 设置；图标卡；i18n en+zh |
| S4 CI ✅ | `7155fb1`+`8aec214`+`badeab5` | Studio 首个 CI（`.github/workflows/ci.yml`）+ 环境门控 SDK oracle（含篡改拒绝变异测试） |
| B2 ✅ | 见下注 | iOS 进 DIALOG_PLATFORMS/ALL_BUILD_PLATFORMS；ios 图标卡；`bundleid-ios-adjusted` + `unsigned-ios` preflight；i18n en+zh |

> **B2 的提交归属注意**：B2 的 10 个文件被另一个 agent 的 `aafd922
> feat(story): unify duration handling…` 连带提交（工作树共享 + `git add -A`）。
> 代码完整且已在 develop（lint/181 测试文件全绿），但该 commit message 与内容不符。
> **未重写历史**——该提交已推送且其他 agent 正在同分支在途工作。M3 = **代码侧完成**。

**M2 端到端已验证（真 app + 真项目 demo2）**：选 Android → 产出
`Demo-0.1.0-android.apk`（12.8 MB / 33 site 文件）；产物名与
predictGameBuildArtifacts 一致；加密项目输出「暂不适用」提示且载荷明文；
dev 模式经 node_modules 解析 debug 模板；纯 Android 构建不产出 web 导出。
**唯一未做的是实机 tap-install**（需真设备）。

**外部 oracle 已跑**（非 Studio 自家解析器）：`7za` APK/IPA 结构 + resources.arsc
为 Store；独立 central-directory 走查确认 stored 条目 4 字节全对齐；`plutil -lint`
判定改写后 Info.plist 合法并读回 5 个 CFBundle 键；`unzip` 确认可执行位 0755；
`openssl` 确认签名证书为合法 RSA-2048/SHA-256 X.509。

**SDK oracle 已落地并实跑（2026-07-16 晚，CI 全绿）**：Studio 此前无任何 CI，现有
`.github/workflows/ci.yml`（ubuntu-latest：lint + test，build-tools 37.0.0）；
oracle 测试在 `src/main/buildWorker/mobile/androidSdkOracle.test.ts`，按
`ANDROID_HOME` 门控（本机跳过，符合 §2.2 的 SDK 不再分发），CI 置
`REQUIRE_ANDROID_SDK_ORACLE=1` 使「SDK 缺失」由静默跳过变为**失败**——跳过与通过
在日志里长得一模一样，这是唯一能防住的手段。8 个 oracle 测试在 CI 全部真跑通过。

**「Android 装机语义」遗留审查——已由 CI oracle 权威回答（结论回填）**：
- **v2-only 对 minSdk 26 足够** ✅：`apksigner verify --min-sdk-version 26 --verbose`
  通过，且断言 `v2 scheme: true` / `v1 (JAR) scheme: false`。v1 仅在 API < 24 必需，
  壳的 minSdk 26 高于该门槛。
- **META-INF / 未保护条目** ✅：apksigner **零 WARNING**（该告警正是它报告
  「容忍但 Android 可能不接受」的方式，如 v2 摘要之外的未保护条目）。
- **重命名一致性** ✅：`aapt2 dump badging` 读回
  `com.example.oraclegame` / versionCode 1002003 / versionName 1.2.3 / label；
  `aapt2 dump resources` 确认**有且仅有一个** package 且已同步改名；
  `aapt2 dump xmltree` 确认零 `<provider>`、全树无 `com.narraleaf.shell.placeholder` 残留。
- **签名覆盖游戏载荷（非仅壳）** ✅：翻转载荷一个字节后 apksigner **拒绝**——
  该变异测试已永久编码，否则上面所有签名断言都可能是空转。
- `zipalign -c 4` 通过。

**本轮新增的实现决定**：
1. **图标槽位尺寸从模板自身的占位 PNG 读出**（`mobileIcons.ts`），不按密度名硬编码
   映射。manifest v1 的 `iconSlots` 只给路径不给尺寸；硬编码「xxhdpi = 144」会重复
   壳仓库已有的知识，且壳新增槽位当天就会静默出错。
2. **iOS 暂不进 DIALOG_PLATFORMS**（B2 的实质内容）：代码已全通，但 M3 验收要求
   「未签名 IPA → 第三方重签 → 旁加载 → 实机可玩」，未验证前不在 UI 承诺。
3. **preflight 体积检查为单向推断**：只在「素材本身已超上限」时报错（编译产物必
   含全部素材，故必然失败）；不由未压缩体积反推编译后体积，避免误杀合法构建。
   真限额仍由 worker 对真实字节强制。

**M2/M3 代码侧均已完成，双端从构建对话框可选、可产出**（2026-07-16 晚实测：
一次构建同时产出 `Demo-0.1.0-android.apk` 13.4 MB + `Demo-0.1.0-ios.ipa` 12.7 MB；
IPA 经 `7za`/`plutil` 判定：`Payload/Demo.app` 已按产品名重命名、Info.plist 合法且
五键正确、`CFBundleExecutable` 保持模板值 `Shell`、可执行位 0755、载荷为移动变体）。

**下一步（全部需要真设备，代码侧无剩余卡点）**：
①**实机 tap-install 收口 M2**——oracle 已答「Android 会接受这个签名」，
但「装上去能玩」仍是推断；②M3 = 未签名 IPA → 第三方重签 → 旁加载 → 实机可玩；
③W0 实机验证（§12.4 清单）+ iOS test-payload 自检，**自定义 scheme 下 IndexedDB
是否可用是唯一真实存疑点**（存档全靠它；Android 侧用 https 伪 host 已规避）；
④M4 移动端资产加密——**当前明确未实现**，状态见下。

### 12.0.2 移动端资产加密（M4）的确切现状

> **✅ 已实现（2026-07-24）——详见 `docs/plans/2026-07-23-006-task-mobile-encryption-rollout.md` §7。** 下方 2026-07-16 的「未实现」判断已过时，保留作历史。落地摘要：
> - 私有仓 `@narraleaf/encryption@0.4.1`（含 Android `.so` 三 ABI + iOS `NlCrypto.xcframework` 静态库）已发布 npm。
> - 壳仓库 iOS 解码器接完（`ContentDecoder` 改按文件 open + `NativeContentDecoder.swift` 桥接 `nlc_*`，静态链接，fail-loud），Android 早已接完；`@narraleaf/studio-shell@0.2.0` 已发布（带解码器，实测 `nm`/`unzip` 验证）。
> - Studio 移动 repack 逐文件 `encryptBuffer` + `contentKey` 写入明文 shell-config；`mobile-unprotected` 提示/i18n 撤除；`@narraleaf/studio-shell` pin 0.1.0→0.2.0（密文唯一版本闸门）。外部 `unzip` oracle 断言密文≠明文、shell-config 明文带 key；main/shared typecheck + 全套移动/构建/编译测试绿。
> - 顺序红线全程遵守（壳先发布并 pin，Studio 再翻密文）；两公开仓 diff 零机制词汇（保密审计通过）。
> - 遗留：iOS 模拟器实机解密属「尽可能」项，本机无 runtime 未跑；全仓 CI `yarn lint` 另被一处**既有** renderer/NLR 缺口阻塞（M5 用 narraleaf-react 0.16 API 但 pin 仍 ^0.15，与本卡无关，已开后台任务）。

**结论（历史，2026-07-16）：未实现，且无法在 Studio 侧单独实现。** 现状核对：

| 目标 | 保护状态 |
| --- | --- |
| 桌面 | ✅ 已实现：`encryptAssets` → `resolvePackEncryptionKey` → sealed pack（经 `@narraleaf/encryption` 原生模块） |
| Web | ⛔ 有意明文（静态站点无法承载保护层） |
| 移动 | ⛔ 明文 + 诚实提示（`mobile-unprotected`）；壳内 `ContentDecoder` 恒等门已就位 |

**缺口是壳侧的原生解码器**：`@narraleaf/encryption` 的 npm 包只发桌面 prebuilds
（darwin-arm64 / darwin-x64 / linux-x64 / win32-x64），**无 Android `.so`、无 iOS
静态库**——正是 §8 要求私有仓新增的产物。

**为什么不能只做 Studio 半边**：Studio 单方面把移动载荷改成密文，而壳只有恒等
decoder → 产出的 APK/IPA 解不开自己的资产，游戏直接坏掉，**严格劣于当前明文**。
把机制实现进壳仓库则违反 §2.4 硬约束（壳只允许通用 decoder 接口）；用 JS 解码器
放进载荷等于把密钥与机制明文摆出，与 web 明文同理无意义。

**因此 M4 的第一步仍是私有仓**（NDK 交叉编译 .so / iOS 静态库 + 跨私有仓 artifact
授权），之后壳换掉恒等 decoder，最后 Studio 把 §6.2 的明文分支切到密文 pack 路径
（`mobile-unprotected` 提示同步改写）。三仓顺序不可颠倒。

### 12.0.1 历史状态（2026-07-16 早，repack 核心落地时）

**已完成并合入 develop**——Studio 侧**纯 repack 工具链全部就位**，全部在
`src/main/buildWorker/mobile/`（107 个单测，4 个 tsconfig 绿；每项均经对抗审查
+ 外部 oracle 验证：openssl / plutil / 7za）：

| 项 | 模块 | 备注 |
| --- | --- | --- |
| A1 ✅ | `@shared/types/gameBuild.ts` 等 | 四处静默波及点已治理；UI 闸门仍关闭（留 A7/B2） |
| A3 ✅ | `zipModel.ts` `zipWriter.ts` | 流式/对齐（apksig 0xd935 含 multiple）/zip64（65535 哨兵边界）/权限位/确定性（UTC DOS 时间） |
| A4 ✅ | `axml.ts` `arsc.ts` | string-pool 全量重建 + 点前缀 authorities 重命名；arsc 定长槽原地写 |
| A5 ✅ | `x509.ts` `signingIdentity.ts` `apkSigningV2.ts` | **自写最小 X.509 DER，未引入 node-forge**（见下）；含独立 `verifyApkV2` 自校验器 |
| B1 核心 ✅ | `plist.ts` `repackIpa.ts` | Info.plist 补丁 + IPA 编排（`Payload/<Name>.app`、显示名、方向、图标、权限位保真） |
| A6 核心 ✅ | `repackApk.ts` `androidFixtures.ts` | APK 编排：读补丁 manifest/arsc → 注入 → 对齐 → v2 签名 |
| 契约 ✅ | `mobileShellManifest.ts` | `MobileShellManifest` 类型 + schema-version-first 校验器 |

**对计划的两处实现偏离（已生效，后续照此为准）**：

1. **不引入 node-forge**（§6.3 曾写「允许引入纯 JS 依赖，如 node-forge」）。
   改为自写最小 ASN.1 DER + X.509（`x509.ts`）：`node:crypto` 已能生成密钥与
   签名，只缺证书结构组装；且 `crypto.X509Certificate` 能解析并验证自产证书，
   提供了不依赖第三方的仓内 oracle。理由：供应链最小化（与壳的零第三方依赖
   同精神）、避开 node-forge 维护状况。**Studio 未新增任何运行时依赖。**
2. **repack 器为 Buffer-in/Buffer-out 纯函数**（§12.3 曾写 repackApk 是「唯一碰
   fs 的层」）。fs 全部留给 A6 的 manager/worker 接线，repack 器因此可用合成
   fixture 完整单测。**代价**：整包在内存中组装，受 Node Buffer 上限（~2 GiB）
   约束——A7 的 preflight 必须加产物体积检查（与 §4 风险 3 的 4 GiB 墙合并处理）。

> 以下「未完成」清单为当时快照，**均已在当日晚间完成**（S1–S4、A2、A6、B1、A7）；
> 现状以 §12.0 为准，此处仅保留当时的阻塞关系记录。
>
> - **W0**（Phase 0 实机验证）：未做，需真机，清单见 §12.4。不阻塞任何代码。
>   —— **仍未做**（见 §12.0 下一步）。
> - **S1–S4**（Studio-Shell 壳仓库）：当时是唯一总卡点 —— 现已全绿并发布
>   `@narraleaf/studio-shell@0.1.0`。
> - **A2 / A6 接线 / A7 / B1 / B2**：当时依次被上游阻塞 —— 除 B2（iOS UI，待
>   实机重签验证）外均已落地。
> - **M4 加密 / M5+**：首轮非目标。

> **iOS 开发可在本机进行**（有 Xcode/plutil/codesign），故 S3 与 iOS 侧模板
> 构建不必等 CI；Android 侧的 SDK oracle 仍只在 CI（§2.2）。

### 12.1 PR 地图（M0–M3）

依赖 DAG（`⇢` = 仅「真模板验证」部分依赖，代码可先行）：

```
W0 (Phase 0 实机验证) ───────────────────（校准 M1 优先级，不阻塞代码）
S1 骨架 → S2 Android 壳 ─┐
        → S3 iOS 壳 ─────┼→ S4 CI 断言 + npm 首发
                          │
Studio: A1 类型 → A2 模板分发链路（需 S4）
        A1 → A3 zip 基建 ⇢S4 → A4 axml/arsc ⇢S4 → A5 v2 签名 ⇢S4
        A2+A3+A4+A5 → A6 worker/manager 接线 → A7 UI/i18n/preflight = M2 完成
        A3+A6+S4 → B1 iOS repack → B2 iOS UI 暴露 = M3 完成
```

| # | 内容 | 仓库 | 依赖 | 完成定义 (DoD) |
|---|---|---|---|---|
| W0 | Phase 0 实机验证（现有 web 导出直测，§12.4 清单） | Studio（无代码） | 无 | findings 落 `docs/notes/`；§11.3 校准、§11.6 清单初稿 |
| S1 | 壳仓库骨架：目录、gradle/xcodebuild 最小工程、最小 build-shells.yml、CONTRACT.md 草案；定稿 minSdk=26、targetSdk、iOS deployment target（`isInspectable` 需 16.4+ 守卫）、零第三方依赖规则（Android 至多 androidx.webkit；iOS 仅系统框架） | Studio-Shell | 无 | CI 双 job 绿，4 个未签名产物（release/debug × android/ios）可下载；占位符与依赖规则全进 CONTRACT.md |
| S2 | Android 壳完整实现：拦截 serving（Range/206、流式、MIME）、ContentDecoder 恒等门、shell-config.json、沉浸全屏、运行时 setRequestedOrientation、`mediaPlaybackRequiresUserGesture=false`、release 关 WebView 调试 | Studio-Shell | S1 | test-payload 自检页（Range/MIME/IndexedDB/桥环境断言）模拟器或实机全 PASS；debug 变体可 chrome://inspect；依赖零第三方 |
| S3 | iOS 壳完整实现：WKURLSchemeHandler serving（Range 必须）、ContentDecoder、shell-config、`allowsInlineMediaPlayback=true` + `mediaTypesRequiringUserActionForPlayback=[]`、`isInspectable` 仅 debug | Studio-Shell | S1 | 同一 test-payload 模拟器 PASS（模拟器构建仅供测试；发布物仍是 iphoneos device 构建）；仅链接系统框架 |
| S4 | CI 断言强化 + pull-prebuilds.js + make-manifest.js + npm/ 布局 + `@narraleaf/studio-shell@0.1.x` 首发。断言：aapt2 dump badging 占位符、合并 manifest 零 `<provider>`（防 authorities 前缀串 → `INSTALL_FAILED_CONFLICTING_PROVIDER`）、iconSlots 与产物 APK 实际 zip 条目一致（AGP 会把 `mipmap-mdpi/` 重写为 `mipmap-mdpi-v4/`，槽位从产物枚举）、gradle 依赖零第三方、plutil -lint（plist 必须 XML）、可执行位、无 symlink | Studio-Shell | S2, S3 | 干净机器 `npm i` 拿到双端模板 + manifest.json；schemaVersion=1 固化 |
| A1 | 类型层：platform 加 android/ios、GameBuildMobilePlatform、formats 映射（`apk`/`ipa`）、hostCanBuildTarget 显式列举移动恒真、predictGameBuildArtifacts 移动命名 helper（去掉 `as GameBuildDesktopPlatform` 断言改显式分支）、deriveAndroidVersionCode、normalizeAndroidPackageName / normalizeIosBundleId、arch 对移动忽略；**四处静默波及点显式处理**：`isDesktopTarget` 类型谓词（GameBuildManager）、`isDesktopPlatform`（buildDialogState）、predictGameBuildArtifacts 的 as 断言、hostCanBuildTarget fall-through；报错的 Record 补全；UI 暴露闸门（DIALOG_PLATFORMS、ALL_BUILD_PLATFORMS）不加；run() 对移动 target 临时抛「尚未支持」（A6 移除） | Studio | web target ✅ | lint+test 绿；静默波及点全部有单测；现有桌面/web 行为零变化 |
| A2 | 模板分发链路：`@narraleaf/studio-shell` 进 devDependencies、精确锁定（模板只在 pack 时与 dev 模式需要，运行时依赖会随 asar+extraResources 双份分发）、prepare-mobile-shell.js、pack-electron.js 接线、resolveMobileShellDirForApp（isPackaged 双轨）、模板变体选择（dev 模式 repack 用 template-debug、打包版恒用 release）、manifest schema 校验模块 | Studio | S4 | dev 模式解析 node_modules 模板并通过校验；`yarn pack-electron` 产物内 resources/mobile-shell/ 齐全 |
| A3 | zip 基建：zipModel.ts + zipWriter.ts（条目级流式、store/deflate、4 字节对齐、zip64、unix 权限位、固定 mtime） | Studio | A1（真模板 ⇢S4） | 合入门槛：合成 fixture 单测绿（对齐/权限位/流式内存上限/zip64）。真模板验收（S4 后补勾）：直通 repack 经 CI oracle 签名后实机可装 |
| A4 | 二进制补丁器：axml.ts（string pool 全量重建；占位 applicationId 按精确 + 点前缀双规则重写）+ arsc.ts（定长 UTF-16 槽原地写）；合成 fixture 单测 + 真模板 golden（模板缺席 skip） | Studio | A3（golden ⇢S4） | 合入门槛：幂等、未知 chunk 字节保真、池索引重建断言绿。真模板验收：CI oracle aapt2 读回目标身份 |
| A5 | 签名：signingIdentity.ts（node:crypto keygen + node-forge 证书 DER，main 侧持久化 userData、跨项目复用）+ apkSigningV2.ts（分块摘要、signing block、EOCD 修正、verifyApkV2 自校验器）；Studio 最小 CI（vitest + 环境门控 SDK oracle：apksigner verify / zipalign -c） | Studio | A4（oracle ⇢S4） | 合入门槛：自校验器单测绿。验收：CI apksigner verify 通过；实机 tap-install 成功；同身份覆盖安装成功 |
| A6 | 接线：protocol.ts mobile job、runGameBuild.ts 分发、repackApk.ts、GameBuildManager 移动分支（staging-web 复用/与 web 同选只编译一次、mobile index.html 变体注入、模板校验、identity/versionCode、图标 nativeImage 多尺寸缩放、图标缺失 = console 警告 + 模板默认图标、encryptAssets 开启时输出「资产保护暂不适用于移动导出」提示且载荷明文（§6.2，M4 切换落点）、repack 阶段流式日志进 Build 频道） | Studio | A2–A5 | 全链路产出 APK；产物名与 predictGameBuildArtifacts 一致；双目标只编译一次；encrypt 项目提示出现且载荷明文 |
| A7 | UI 最小接入：DIALOG_PLATFORMS + ALL_BUILD_PLATFORMS 加 android、ProjectIconPlatform/ProjectAssetsSection 加 android 图标卡、orientation 设置（app.mobile.orientation）、preflight 新 code（mobile-template-missing error / version-uncodable error / appid-android-adjusted warning / icon-missing 复用 detail.platform=android / encrypt 提示镜像 web-unprotected 口径）、i18n en+zh | Studio | A6 | **M2 端到端验收**：样例项目→选 Android→APK→实机安装→可玩（音视频 seek、存档写读、重进存档在）；encryptAssets 项目构建→提示出现 |
| B1 | iOS repack：plist.ts + repackIpa.ts（Payload 重排为 `<ProductName>.app`、Info.plist 改写、图标、zip64+权限位保真）+ protocol ios 块；CFBundleShortVersionString 与 CFBundleVersion 用同一净化值（剥离预发布/构建元数据后的数字三段） | Studio | A3, A6, S4 | 单测绿（plist 字段、可执行位、Payload 布局、无 symlink）；产物结构与 CONTRACT.md 一致 |
| B2 | iOS UI 暴露：DIALOG_PLATFORMS/ALL_BUILD_PLATFORMS 加 ios、图标卡、preflight（bundleid-ios-adjusted warning、「未签名 IPA」提示）、i18n | Studio | B1 | **M3 端到端验收**：未签名 IPA→第三方重签→旁加载→实机可玩同 M2 清单 |

### 12.2 Studio-Shell 骨架（S1 文件清单）与发布链

```
NarraLeaf/Studio-Shell
├─ README.md / LICENSE (MPL-2.0) / .gitignore
├─ .github/workflows/build-shells.yml
├─ docs/CONTRACT.md            # manifest.json + shell-config.json 版本化 schema；
│                              # minSdk/targetSdk/iOS deployment target 定稿值；
│                              # 零第三方依赖规则；占位符清单
├─ test-payload/www/           # 自检载荷：Range 206、Content-Type、IndexedDB、
│                              # 桥环境、流式大文件断言；页面显示 PASS/FAIL
├─ android/
│  ├─ settings.gradle.kts / build.gradle.kts / gradle.properties
│  ├─ gradle/wrapper/* / gradlew / gradlew.bat
│  └─ app/
│     ├─ build.gradle.kts      # applicationId com.narraleaf.shell.placeholder
│     │                        # minSdk 26 / versionCode 1 / versionName "0.0.0"
│     │                        # minify 关闭（补丁目标稳定）
│     └─ src/main/
│        ├─ AndroidManifest.xml  # 占位 label 为字面量（CI 断言非资源引用）；
│        │                       # 不写死 screenOrientation（运行时定向）
│        ├─ kotlin/com/narraleaf/shell/
│        │  ├─ MainActivity.kt / ShellConfig.kt / Mime.kt
│        │  ├─ ContentDecoder.kt   # interface + IdentityContentDecoder（恒等；
│        │  │                      # 只有字节/流进出的通用形状）
│        │  └─ WwwServer.kt        # shouldInterceptRequest：约定 https 伪 host
│        │                         # （保 secure context + IndexedDB），Range/206、
│        │                         # 流式、MIME；读字节统一过 Decoder
│        └─ res/
│           ├─ mipmap-{mdpi..xxxhdpi}/ic_launcher.png   # 固定名占位
│           └─ values/{styles.xml,themes.xml}
├─ ios/
│  ├─ Shell.xcodeproj/project.pbxproj
│  └─ Shell/
│     ├─ Info.plist            # XML；占位 CFBundle*；CFBundleIcons→固定名 PNG
│     ├─ AppDelegate.swift / ShellViewController.swift / ShellConfig.swift
│     ├─ WwwSchemeHandler.swift  # WKURLSchemeHandler：Range/206、流式、MIME、Decoder 门
│     ├─ ContentDecoder.swift
│     └─ AppIcon60x60@2x.png 等固定名 PNG
├─ scripts/
│  ├─ pull-prebuilds.js        # 照抄 NarraLeaf-Encryption 的 gh CLI 模式
│  └─ make-manifest.js         # iconSlots 从构建产物 APK 实际条目枚举
└─ npm/
   ├─ package.json             # @narraleaf/studio-shell；files: android/ ios/ manifest.json
   └─ README.md
```

build-shells.yml：`push: main` + `workflow_dispatch`；android job（ubuntu-latest，
SDK 用 runner 预装、绝不进产物）`./gradlew assembleRelease assembleDebug` → S4
断言步 → upload-artifact；ios job（macos-14）`xcodebuild … -sdk iphoneos
CODE_SIGNING_ALLOWED=NO CODE_SIGN_IDENTITY=""` → 断言步 → `ditto -c -k
--keepParent` 保权限位 zip → upload。发布同 encryption 纪律：本地
`pull-prebuilds.js` → `make-manifest.js` → `npm publish`。

manifest.json（契约 v1）：`schemaVersion`、双平台 `template`/`templateDebug`、
`placeholders`、`iconSlots`（从产物枚举）、`wwwRoot`、`shellConfigPath`、
`minSdk`、`appDirName`/`executableName`（iOS）、`shellConfigSchemaVersion`。
shell-config.json v1：`{ schemaVersion, orientation, backgroundColor }`——背景
色与 webShell pre-boot 背景同源（`resolveGameRuntimeInitialBackgroundColor`）。

### 12.3 repack 器模块设计与测试

```
src/main/buildWorker/mobile/
├─ zipModel.ts        # 纯数据：EOCD/CD 解析、条目元数据、zip64；Buffer→结构，零 fs
├─ zipWriter.ts       # 流式写出：条目源 = Buffer | 磁盘文件 | 模板条目透传（压缩
│                     # 条目原样搬运不解压）；store/deflate 按扩展名；未压缩条目
│                     # 4 字节对齐（extra field 填充，等价 zipalign）；arsc 强制
│                     # store+对齐；zip64（仅 ipa）；权限位写 external attributes；
│                     # mtime 用注入的固定时间戳（可复现构建 = golden 前提）
├─ axml.ts            # patchBinaryManifest(buf, patch): Buffer —— chunk 级解析，
│                     # string pool 全量重建、chunk 尺寸重算；versionCode 是类型化
│                     # int 属性（4 字节槽直写）；未知 chunk 原字节透传；占位包名
│                     # 按精确 + 点前缀双规则替换
├─ arsc.ts            # patchArscPackageName(buf, name): Buffer —— ResTable_package
│                     # 头部 char16[128] 定长槽原地 UTF-16LE 写
├─ apkSigningV2.ts    # signApkV2：1MiB 分块摘要（条目区/CD/EOCD 三段，EOCD 的 CD
│                     # 偏移按规范替换）、signing block 插入（CD 条目 local header
│                     # 偏移不变，只修 EOCD 的 CD 起始偏移）；含 verifyApkV2()
├─ signingIdentity.ts # debug 级 RSA-2048 自签身份：node:crypto keygen + node-forge
│                     # 证书 DER；main 侧调用并持久化 userData/mobile-signing/
│                     # （跨项目复用 → 覆盖安装不换签名）；worker 只收 PEM/DER 串
├─ plist.ts           # patchInfoPlist(xml, patch): string —— 只改顶层 dict 目标 key
├─ repackApk.ts       # Android 编排（唯一碰 fs）：模板索引→条目计划→流式写→签名
└─ repackIpa.ts       # iOS 编排：template.app.zip → Payload/<Name>.app/** 重排 →
                      # 注入/改写 → zip64 ipa（不落盘解压，条目级搬运保权限位）
```

worker job（protocol.ts 增量；worker 只见预解析 JSON，身份生成、versionCode
派生、包名/bundleId 归一化、图标 nativeImage 缩放全在 manager 侧）：

```ts
type GameBuildWorkerMobileJob = {
    sourceDir: string;                 // staging-web 编译产物（与 web job 同源）
    templateManifest: MobileShellManifest;
    android?: {
        templateApkPath: string;       // release/debug 由管理器按 isPackaged 选定
        outputName: string;            // <base>-<version>-android.apk
        applicationId: string;         // normalizeAndroidPackageName 之后
        versionName: string;           // 原始 semver（Android 接受任意串）
        versionCode: number;
        iconPngBySlot?: Record<string, string>;
        signingIdentity: { privateKeyPem: string; certificateDer: string };
    };
    ios?: {
        templateAppZipPath: string;
        outputName: string;            // <base>-<version>-ios.ipa
        bundleId: string;              // normalizeIosBundleId 之后
        shortVersionString: string;    // 与 bundleVersion 同一净化值（数字三段）
        bundleVersion: string;
        iconPngBySlot?: Record<string, string>;
    };
    productName: string;
    orientation: "landscape" | "portrait" | "auto";
    indexHtmlOverride: string;         // 移动变体 index.html（viewport-fit=cover）；
                                       // 注入时覆盖 www/index.html，staging-web 不污染
    shellConfigJson: string;
};
```

测试四层：①合成 fixture 单测（不依赖模板，= A3/A4/A5 合入门槛）：手工构造最小
AXML/arsc → 补丁 → 读回；幂等、未知 chunk 保真、点前缀替换。②真模板 golden
（devDependency，缺席 skip）：对齐检查器、arsc store+对齐、verifyApkV2、
`7za l -slt`（packageWebSite.test.ts 先例）；ipa 权限位/plist/无 symlink。
③SDK oracle（环境门控 `ANDROID_HOME`，主落点 Studio CI ubuntu runner）：
`apksigner verify --verbose` + `zipalign -c 4`。④规模测试：多 GB 载荷流式
内存上限、zip64、APK 4GiB 超限报错路径。

### 12.4 风险与验证顺序 + M0 清单

风险前三：①APK Signature Scheme v2 的 TS 实现（错一字节即拒装）；②AXML
string pool 全量重建（双编码池、样式跨度、resource map 耦合、包名前缀串）；
③流式 zip 对齐/zip64/体积边界（API 30+ arsc 硬要求；APK 无 zip64，4GiB 墙
preflight 报错；ipa 需要 zip64；Windows 权限位保真靠条目级搬运）。

验证顺序（oracle 在 CI；实机安装 = 文件传输 + 点按，全程无 SDK）：
V1 直通 repack（不补丁不签名）→ oracle 签名 → 实机装，证 zipWriter 字节级正确；
V2 + axml/arsc 补丁 → oracle 签名 → 实机装 + aapt2 读回身份；
V3 TS 签名替换 oracle → apksigner verify + 实机装 + 同身份覆盖安装；
V4 真实项目 + 大载荷：可玩、音视频 seek（Range 走壳 serving）、内存峰值、4GiB 报错。

M0 实机验证清单（现有 web 导出）：
- 准备：样例项目覆盖入场自动 BGM、带 seek 视频、长音频、存档点、全屏、选择支；
  web dir 导出；局域网起支持 Range 的服务器（`npx http-server`；先用
  `curl -sD - -H "Range: bytes=0-99" …` 确认 206——python http.server 不支持
  Range，不要用）
- Android Chrome / iOS Safari 各一轮：加载与布局、触控（点按/长按/拖动/双击
  误缩放）、音频拦截与首触恢复、视频播放 + seek（服务器日志确认 206）、长音频
  seek、存档写→刷新→读 + 关浏览器重开仍在、全屏 API、旋转表现、安全区遮挡、
  帧率主观、连续 10 分钟内存/发热
- iOS 额外：视频是否被强制原生全屏播放器（`playsinline` 属性缺失 = NLR 侧
  待办，壳的 allowsInlineMediaPlayback 帮不上）；WebAudio AudioContext.state
  是否 suspended（校准 §11.3 备选垫片）
- 真 WebView 行为（引擎同、策略位不同）待 M1 debug 壳复测，差异本身是记录项
- 产出：`docs/notes/` findings（截图/录屏）+ §11.6 触屏清单初稿 + NLR 侧配合项

### 12.5 模板必须满足的契约（Studio 侧已实现并强制校验）

Studio 的 repack 器已落地，**模板不满足下列任何一条即在 repack 时抛错**（不是
静默降级）。壳仓库（S1–S4）必须照此产出，CONTRACT.md 与 CI 断言应逐条覆盖。
权威定义见 `src/main/buildWorker/mobile/mobileShellManifest.ts`
（`MobileShellManifest`，`schemaVersion` 当前 = 1）。

**通用**
- `manifest.json` 必须符合 `MobileShellManifest`，`schemaVersion: 1`；
  Studio 先校验版本再校验结构，不匹配即报「Studio 与壳模板版本不兼容」。
- `iconSlots` **必须从构建产物枚举**（AGP 会把 `res/mipmap-mdpi/` 重写成
  `res/mipmap-mdpi-v4/`），不能从源码常量写死。Studio 若拿到一个模板里不存在
  的槽位会**报错**（防止静默沿用占位图标）。
- 模板**不得含 symlink**（repack 会拒绝——zipWriter 只写普通文件与目录）。

**Android 模板（`template.apk` / `template-debug.apk`，未签名）**
- 必须含 `AndroidManifest.xml`（二进制 AXML）与 `resources.arsc`。
- `resources.arsc` **有且仅有一个 package**（多包时 repack 拒绝，不猜）。
- `android:label` **必须是字面量字符串**，不能是资源引用（`@string/...`）——
  资源引用在 arsc 里，patcher 够不着，会抛「不是字面量字符串」。
- `android:versionCode` 必须是类型化 int 属性、`android:versionName` 是字符串。
- 占位包名 `com.narraleaf.shell.placeholder`：Studio 会做**精确 + 点前缀**全池
  重命名（跟随 `<placeholder>.provider` 一类派生串）。**CI 仍须断言合并后
  manifest 零 `<provider>`**，否则两个游戏的 authorities 会撞
  `INSTALL_FAILED_CONFLICTING_PROVIDER`。
- 图标为固定文件名的普通 mipmap PNG（不是需要 aapt2 编译的 adaptive icon XML
  引用新资源的形态）。

**iOS 模板（`template.app.zip` / `template-debug.app.zip`，未签名）**
- zip 内所有条目以 `manifest.ios.appDirName`（如 `Shell.app/`）为前缀
  （即 `ditto -c -k --keepParent Shell.app` 的形态）。
- `<app>/Info.plist` 必须是**纯文本 XML plist**（CI `plutil -lint` 断言），且
  **顶层必须存在**这些 key（缺任一即抛错）：`CFBundleIdentifier`、
  **`CFBundleDisplayName`**、`CFBundleShortVersionString`、`CFBundleVersion`、
  `UISupportedInterfaceOrientations`（`~ipad` 变体可选）。
  ——`CFBundleDisplayName` 是主屏显示名；模板不带这个占位 key，repack 就无法
  把游戏名写进去。
- 可执行文件名 = `manifest.ios.executableName`，权限位 0755（repack 原样保真）。
- 无 embedded frameworks（最小壳不需要，且会引入 symlink）。

**Studio 侧对应的验收 —— 已全部跑通（2026-07-16 晚）**
- ✅ `repackApk`/`repackIpa` 对**真模板** golden 测试（`runMobileRepack.test.ts`，
  含可复现性与注入顺序确定性）。
- ✅ CI oracle：`apksigner verify --min-sdk-version 26`、`zipalign -c 4`、
  `aapt2 dump badging`/`dump resources`/`dump xmltree` 读回目标身份 + 篡改拒绝
  （`androidSdkOracle.test.ts`，SDK 只在 CI，见 §2.2）。结论见 §12.0。

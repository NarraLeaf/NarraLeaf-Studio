---
title: "feat: 移动端（Android / iOS）构建管线"
type: feat
status: planned
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
   npm 包。SDK 只允许出现在 GitHub CI runner 上（GitHub 托管 runner 预装，属于
   GitHub 与 Google 的授权范围）。可再分发的例外：Temurin JDK（后续 AAB 批次若
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
  `setWebContentsDebuggingEnabled`；iOS 不开 `isInspectable`）。模板 CI 同时出
  debug 变体供 Studio Dev 场景与实机排障（是否随 npm 包发布 debug 变体：发布，
  但 Studio 只在开发模式使用）。
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
4. **模板↔Studio 版本纪律**：manifest.json schema 版本已挡住错配，但
   npm 版本升级节奏（模板改动是否总是伴随 Studio 发版）待 M1 后回顾。
5. **versionCode 派生规则**：从 semver 派生单调整数的具体公式在 M2 实现时
   定稿（预发布版本的处理要明确）。
6. **触屏适配清单**（hover 态、字号、安全区 letterbox）：产品级 QA 项，
   Phase 0 输出清单，另立计划。

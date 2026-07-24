# 2026-07-23-006 · 移动端资产加密管线落地 — 事实表与执行计划

- 状态：权威快照（2026-07-23，主会话三路审计 + npm/仓库实证）
- 上游计划：docs/plans/2026-07-15-002-feat-mobile-build-pipeline.md（M4 里程碑；本卡取代其 M4 一节中已过时的前提）
- 涉及仓库：NarraLeaf-Studio（develop）、../Studio-Shell（master）、../NarraLeaf-Encryption（私有，main）

## 0. 目标一句话

让加密项目的 Android/iOS 构建产出受保护资产包（与桌面端同等体验），玩家侧零新增要求；关键路径上只剩一次用户发布闸门（`@narraleaf/studio-shell` 新版）。

## 1. 全景状态矩阵（2026-07-23）

列 = 游戏目标平台；「Studio@…」= Studio 宿主版本的能力。

| 层 | Windows | macOS | Web | Android | iOS |
|---|---|---|---|---|---|
| 1 编译打包 | ✅ nsis/zip/dir，任意 host | ✅ dmg/zip/dir，仅 macOS host | ✅ 静态站+zip | 🟡 debug APK 可产出，欠真机验证 | 🟡 未签名 IPA 可产出，欠模拟器/真机验证 |
| 2 资产加密（产物） | ✅ 可选开启 | ✅ 可选开启 | ➖ 已决定不支持（编译器硬禁止） | 🟡 壳已接原生解码器；欠壳发版+Studio 翻密文 | ❌ 壳解码器未接线（本卡主要工程） |
| 3 加密·Studio@macOS | ✅ | ✅ | ➖ | 🟡 管线打通后即可 | 🟡 同左 |
| 3 加密·Studio@Windows | ✅ win32-x64 prebuild | ➖ 该 host 无法构建 macOS 目标 | ➖ | 🟡 理论可行未实测 | 🟡 同左 |
| 4 签名（产物） | ❌ 无 Authenticode | ❌ 未签名未公证 | ➖ | 🟡 debug 自签可侧载；release 未做 | ❌ 完全未签名 |
| 5 签名·Studio 双宿主 | ❌ 未实现 | ❌ 未实现（实现后仅 macOS host） | ➖ | 🟡 debug 可用；release 未实现 | ❌ 未实现（codesign 路线→仅 macOS host） |

第 4/5 层（签名）**不在本卡范围**，另行排期。

## 2. 硬性约束（全部必须遵守，序 1 凌驾一切）

1. **保密红线**：公开仓（NarraLeaf-Studio、Studio-Shell）的代码、接口命名、注释、文档、commit message、测试名、错误文案中，不得出现加密机制的任何信息（算法、格式、派生方式、内部命名、实现细节）。公开侧只允许：「字节进字节出」的中性 ContentDecoder 表述、`nlc_*`/`libnlcrypto`/`NlCrypto.xcframework` 等已有公开先例的符号与文件名、`@narraleaf/encryption` 公开 npm API 名。私有仓 INTERNAL.md、实现与 git log 内容不得迁移到公开仓。
2. **顺序红线**：在「带解码器的壳模板已发布到 npm 且被 Studio pin 住」之前，Studio 不得产出密文移动包（否则产出解不开自己资产的坏包，严格劣于明文）。
3. Dev Mode 与 web 导出**永不加密**（compiler 对 `shell:"web"+key` 的硬 throw 语义保持）；桌面 Preview 与生产走同一 key 路径。移动端无 preview 路径，无需处理。
4. Studio **零新增运行时依赖**（node-forge 否决先例）；壳仓库**零第三方依赖**。
5. 用户侧硬约束：全离线、零工具链、TS-only repack——加密不得给作者或玩家增加任何安装要求。
6. Android SDK 组件不可再分发（只活在 CI）。
7. **npm publish 只能用户做**（2FA）：`@narraleaf/studio-shell` 新版是唯一剩余发布闸门。
8. 共享工作树纪律：其他 agent 并发编辑同一 checkout——禁 `git add -A`/`git add .`，只 add 自己改的文件；开工先 fetch 各仓库。
9. Studio 仓库故意不提交 yarn.lock；CI 用 `yarn install --no-immutable`。
10. i18n：en 与 zh 目录同步改；若涉及 lib/ui-editor 的 i18n，改完必须 `yarn build`。
11. UI 文案不用 ALL-CAPS，不向用户显示内部 id。

## 3. 已验证事实（file:line 为 2026-07-23 快照，开工后以 fetch 后的实码为准）

### 3.1 npm `@narraleaf/encryption@0.4.0`（今日 tarball 实测）

- dist-tags：latest = **0.4.0**（已发布版本：0.2.0 / 0.3.0 / 0.4.0）。
- prebuilds **全量随包**：`prebuilds/android/{arm64-v8a,armeabi-v7a,x86_64}/libnlcrypto.so`；`prebuilds/ios/NlCrypto.xcframework`（`ios-arm64` 与 `ios-arm64_x86_64-simulator` 双 slice，各含 `libnlcrypto.a` + `Headers/nlcrypto_mobile.h` + `module.modulemap`）；桌面 `darwin-arm64/darwin-x64/win32-x64/linux-x64` 的 `nlcrypto.node`。
- `dist/index.d.ts` 全部导出：`RUNTIME_SUPPORT_FILENAME`、`RUNTIME_BUNDLE_FILENAME`、`derivePackEncryptionKey(machineSecret, projectSalt)`、`obfuscateKey(rawKey)`、`encryptBuffer(plain, packKey)`、`isProtectedPayload(buffer)`、`runtimeSupportPath()`、`interface SealedBundleWriter { add(name, data); finalize() }`、`createSealedBundle(filePath, binaryPath): Promise<SealedBundleWriter>`。
- `createSealedBundle` 的双路径签名与 Studio 现有调用形状（gameRuntimeArtifactCompiler.ts:196-204）一致——此前疑似的 API 漂移基本解除，但 P0 仍须以真实安装对拍 + 桌面构建回归为准。注意：sealed 单容器是**桌面**路线；移动路线用 `encryptBuffer`/`isProtectedPayload`（见 P3）。
- `../NarraLeaf-Encryption` 本地 checkout **落后 origin/main 2 个提交**（本地 HEAD 还在 0.3.0）——开工先 pull。

### 3.2 Studio 侧现状

- key 解析仅桌面：GameBuildManager.ts:391-393（`desktopTargets.length > 0 ? resolveEncryptionKey : undefined`）；解析实现 :893-906，复用 packKeyService.resolvePackEncryptionKey，与 Preview 同路径（PreviewManager.ts:134-150）。
- web 与 mobile **共享一次明文编译**（`shell:"web"`、无 key）：GameBuildManager.ts:438-459；mobile job 直接吃 webArtifact：:514-522。
- compiler 对 `shell:"web" + encryptionKey` **硬 throw**：preview/compiler/gameRuntimeArtifactCompiler.ts:153-155；桌面 sealed 路径调用 `createSealedBundle`：:196-204；web bridge 读松散文件：:273-274。
- 「暂不适用」链路：console 提示 GameBuildManager.ts:404-413、preflight finding :275-278、finding code gameBuild.ts:95（`mobile-unprotected`）、文案 zh/build.ts:105 与 en/build.ts:107。
- 壳配置无 contentKey：`MobileShellConfigV1` = {schemaVersion, orientation, backgroundColor}（mobileShellManifest.ts:35-39，buildMobileJob 写入处 GameBuildManager.ts:658-664）；manifest 校验 `SUPPORTED_SHELL_MANIFEST_SCHEMA = 1`（mobileShellManifest.ts:16）。
- 依赖：package.json 声明 `@narraleaf/encryption` **^0.4.0**（现可满足；本地实装仍是 0.2.0，lockfile 陈旧，需重装）；`@narraleaf/studio-shell` 精确 pin **0.1.0**。

### 3.3 Studio-Shell 侧现状

- **Android 已接完**（commit d9c227e）：`NativeContentDecoder.kt`；`MainActivity.decoderFor()`（MainActivity.kt:135-141）在 `config.contentKey != null` 时用原生解码器，否则 identity；**载荷已编码但无解码库时抛错**（:137-139，fail-loud 先例）；`ShellConfig.kt:18-23,76` contentKey 可选；build.gradle.kts:53-61 jniLibs、:66-72 保持 .so deflated；CI build-shells.yml:36-37 跑 `pull-decoder.js`、:116-129 断言三 ABI `libnlcrypto.so`。
- **iOS 缺口清单**（本卡核心工程，且**不止接线——Swift 协议要先改**）：现行 `ContentDecoder` 协议按 chunk 调用且不携带文件身份，而原生解码器需要按文件持状态（公开头文件的 API 形状即如此：按文件 open 得到句柄 → 按偏移逐段解码 → 释放）→ 协议须改为「handler 对每个文件先 open 一个 decoder 实例，再逐 chunk 使用」，这不是接线能绕过的。其余缺口：无 `NativeContentDecoder.swift`；`WwwSchemeHandler.swift:34` 恒 `IdentityContentDecoder()`（调用点 :83/:143；WebView 对媒体发 Range 请求，解码必须支持按 content offset 寻址且高效推进，Android 实现是先例）；`ShellViewController.swift:25-28` 不传 decoder；`ShellConfig.swift:33-35` 无 contentKey；`Shell.xcodeproj/project.pbxproj:37-45` frameworks build phase 为空（`ios/Vendor/NlCrypto.xcframework` 未链接；`pull-decoder.js` 已会把库暂存进 `jniLibs/` 与 `ios/Vendor/`）；iOS CI job（build-shells.yml:153-231）无 pull-decoder 步骤，且 :208-209 断言「no embedded frameworks」（静态库不产生 Frameworks 目录、断言可共存，但需在 CI 里写清说明）。
- `scripts/pull-decoder.js:21-22`：`PACKAGE='@narraleaf/encryption'`、`DEFAULT_VERSION='0.3.0'` → **需改 0.4.0**。注意与 `scripts/pull-prebuilds.js` 区分：后者拉的是壳模板产物、发 `@narraleaf/studio-shell` 用，与私有仓无关。
- `jniLibs/`、`ios/Vendor/` 已 gitignore（构建输入不入库）；make-manifest.js:19 `SCHEMA_VERSION = 1`——解码器烤进模板二进制、contentKey 是 shell-config 可选字段，**manifest schema 不需要 bump**。
- 已发布的 `@narraleaf/studio-shell@0.1.0` 模板内**无解码器**（实测），必须发新版（建议 0.2.0）。

### 3.4 本机工具链

- Xcode 16.2 已装且 xcode-select 已指向（iOS 壳可本地编译自检）；模拟器 runtime 未装（如需模拟器实跑先 `xcodebuild -downloadPlatform iOS`，磁盘充足）；无签名证书（模拟器不需要）；无 Java/Android SDK（Android 壳编译只能靠壳仓库 CI）。

## 4. 执行计划

- **P0 · Studio 依赖收敛与 API 对拍**：pull 私有仓；Studio `yarn install` 拉 0.4.0；对拍全部调用点（sealed 路径、`isProtectedPayload` 等）；跑桌面加密构建回归（必须先绿再往下）。
- **P1 · 壳 iOS 协议重设计 + 接线**：先把 Swift `ContentDecoder` 协议改为按文件 open、逐 chunk 使用（见 §3.3），再落 `NativeContentDecoder.swift` + `ShellConfig.swift` contentKey + `ShellViewController` 传 decoder + pbxproj 链接 `ios/Vendor/NlCrypto.xcframework` + iOS CI 加 pull-decoder 步骤（并写清与 no-embedded-frameworks 断言的共存理由）+ `pull-decoder.js` pin → 0.4.0。Range 请求的按偏移解码必须正确高效（对齐 Android 先例）。**iOS 解码失败必须 fail loud**（对齐 Android :137-139 先例），不得静默渲染乱码。本地 Xcode 自检 + CI 全绿（0.4.0 已在 npm，pull 步骤可转绿）。
- **P2 · 【用户闸门】壳模板发布**：准备好 npm/ 布局、版本号、manifest（schema 1 不变）后**暂停，请求用户执行 `npm publish`**（2FA）。
- **P3 · Studio 翻密文**：bump `@narraleaf/studio-shell` pin → 新版（这也是密文开关的唯一版本闸门）；mobile 侧 key 解析（复用 :893-906 路径）；对移动产物 www 下**每个文件**用 `encryptBuffer` 保护——**不是**桌面的 sealed 单容器路线（壳按文件服务并处理 Range，须与已落地的 Android 解码器行为对齐）；`contentKey`（= `resolvePackEncryptionKey` 返回串）写入 shell-config；撤「暂不适用」console/preflight/i18n（en+zh）；测试更新。逐文件保护的插入点二选一由实现者定：编译层为 mobile 拆受保护变体，或在 buildMobileJob/repack 收集 site 文件时逐文件保护——无论哪种，**web 导出必须保持明文**（compiler 对 web+key 的硬 throw 语义不得放宽）。
- **P4 · 端到端验证**：真 app 构建加密项目 → 外部 oracle 结构断言（7za/unzip 解包：www 载荷为密文非明文、`isProtectedPayload` 判真、shell-config 含 contentKey、schema 1）；非加密项目回归（保持明文、无 contentKey）；web 导出回归（仍明文）；Android CI oracle 复跑；尽可能 iOS 模拟器实跑解密（顺带覆盖 W0 IndexedDB 存疑点）。

### 4.1 翻密文必须保持的不变量

- 有 key 时 www 下**所有文件**都必须受保护——壳按「全保护」不变量估算解码长度，**混合明文/密文布局不支持**；无 key 时全明文（同一个壳跑两种游戏）。
- **`shell-config.json` 本身必须保持明文**（它是解码配置的自举文件）。
- Studio 侧**禁止引入 `obfuscateKey`**——key 一律经 `resolvePackEncryptionKey`（保密红线的具体化）。
- 壳内 `.so` 必须保持 **deflated**（repack 只做 4 字节对齐，未压缩 .so 的对齐要求满足不了，失败发生在装机/加载时；壳 CI 已断言，不要动这条）。
- iOS 与 Android 行为一致：载荷受保护但无解码库/坏 key 时**响亮失败**，不得静默渲染乱码。

## 5. 验收标准

1. 加密项目构建：Android APK 与 iOS IPA 内 www 载荷为密文（外部工具断言非明文），shell-config 含 contentKey，manifest schema 仍为 1。
2. 非加密项目构建：产物与现状一致（明文、无 contentKey、无新警告）。
3. web 导出与桌面构建全回归通过；compiler 的 web+key 硬 throw 语义未变。
4. 壳仓库 CI 全绿（含全部契约断言与解码器断言）；Studio CI（ubuntu）绿。
5. 保密审计：两个公开仓的全部 diff 中零机制词汇（自查 + 逐文件过一遍 diff）。
6. 关键断言防「改坏了仍全绿」：至少密文/明文判定用外部 oracle，不只信 Studio 自家解析器。

## 6. 已知风险

- **W0 存疑点**：iOS 自定义 scheme 下 IndexedDB 可用性未验证（存档依赖它）。若后续验证失败导致 serving 层重构，本卡的 iOS 接线可能需要小范围返工——已知并接受，接线本身工作量小。
- **模板能力探测**：Studio 无法从 manifest 得知模板是否带解码器——用精确版本 pin（P3 bump）作为唯一闸门，不引入能力标志（避免 schema 变更）。
- **体积**：密文与明文体积近似，repack 的 Buffer 上限 preflight（单向推断）语义保持不变。
- 本卡 file:line 均为 2026-07-23 快照；其他 agent 并发改动同一 checkout，开工后以 fetch 后实码为准。

## 7. 实施状态（执行 agent 更新此节）

### P0 · Studio 依赖收敛与 API 对拍 — ✅ 完成（2026-07-23）

- **依赖收敛**：私有仓已在 origin/main（HEAD 816c3cf，`package.json` = 0.4.0）。Studio `yarn install` 把 `@narraleaf/encryption` 从陈旧锁的 0.2.0 升到 **0.4.0**（顺带把同样陈旧的 narraleaf-react 0.13.1→0.15.0 等补齐到 package.json 已声明版本）。实装 `dist/index.d.ts` 现为 `createSealedBundle(filePath, binaryPath)` 新签名；prebuilds 全在（android 三 ABI + ios/NlCrypto.xcframework + 四桌面 .node）。
- **API 对拍（独立脚本，非仅信 Studio 解析器）**：
  - 移动路径全绿：`derivePackEncryptionKey(...)` 返回 88 字符不透明串（= `resolvePackEncryptionKey` 的返回，即移动 `contentKey`）；`encryptBuffer(plain, contentKey)` 产信封、`isProtectedPayload` 对信封判真/对明文判假。此串三处闭环：喂 `encryptBuffer`、写 shell-config、作壳侧 `nlc_open` 的 `obf_key`。
  - 桌面 sealed 写入路径（`createSealedBundle(bundlePath, supportPath)` + `add/finalize`）正常。
  - Studio 全部调用点与 0.4.0 契约一致；**源码零 `obfuscateKey`、零 `encryptBuffer`（后者留待 P3）**，红线满足。（`obfuscateKey` 仅出现在 `dist/` 旧编译产物 `shared/crypto/packCrypto.d.ts`，非 live 源码。）
- **桌面加密回归**：`yarn test` 目标平台为 **ubuntu-latest**（ci.yml:64），linux-x64 prebuild 无签名强制，sealed reader 测试在 CI 绿；桌面 sealed **读写逻辑经独立往返脚本证实完好**（ad-hoc 重签后 `openSealedBundle` 读回正确）。移动 + build 全套 18 测试文件本地 **161 passed / 7 skipped**（skipped = 需 Android SDK 的 oracle）。

**⚠️ P0 附带发现（桌面范畴，早于本卡，非移动工作引起 → 已上报用户，本卡不修）**：v2 桌面路线在 pack 时 patch 支持二进制的 slot 字节，使其原有签名失效。在 **macOS arm64** 上，dlopen 签名失效的 Mach-O 被内核 **SIGKILL(137)**。因此 `gameRuntimeArtifactCompiler.test.ts` 的 sealed reader 测试在 darwin-arm64 本地会崩 vitest worker（CI-linux 无此强制、绿）。真实 mac 游戏若经 electron-builder 签名则运行时正常；但**桌面加密 Preview / 未签名 mac 构建在 Apple Silicon 上会命中此 SIGKILL**——ad-hoc `codesign --force --sign -` 可修复（已实证）。建议在私有仓 pack 侧 `applyRuntimeBinaryMaterial` 之后于 darwin 重签，或在桌面构建/preview 管线加重签步骤。**与移动密文路径无关**（移动走 `encryptBuffer`/`nlc_*`，不 patch/dlopen 二进制）。

### P1 · 壳 iOS 协议重设计 + 接线 — ✅ 完成（2026-07-23，本机 Xcode 16.2 自检通过）

改动仓库 = ../Studio-Shell（master，工作树未提交）。全部改动逐文件保密审计通过（零机制词汇；只用 content/decode/header/prefix/opaque/key/payload + 公开先例 `nlc_*`）。

- **协议重设计**（`ios/Shell/ContentDecoder.swift`）：从「按 chunk、无文件身份」的 `decode(_:at:)`+`decodedLength(_:)` 改为**按文件 open**：`ContentDecoder.open(_:fileLength:) -> FileContentDecoder`；`FileContentDecoder` 暴露 `contentStart`（内容在文件内的起始偏移）+ `decode(_:at:)`（按内容偏移就地解，可独立解任意 Range）+ `close()`。`IdentityContentDecoder`/`IdentityFileContentDecoder` 保留（contentStart=0、透传）。语义对齐 Android `NativeContentDecoder`/`DecodedStream`。
- **原生桥接**（新增 `ios/Shell/NativeContentDecoder.swift`）：`import NlCrypto`（xcframework modulemap 暴露的模块），调用 `nlc_probe_size/nlc_header_len/nlc_open/nlc_decode/nlc_free`。**fail-loud**：headerLen==0（notEncoded）、headerLen≠probeSize（unexpectedPrefix）、nlc_open 返 NULL（keyRejected）、nlc_decode≠1（decodeFailed）全部抛错——对齐 Android :137-139 先例，绝不静默渲染乱码。lifetime 与 Android 一致（只持 ctx 不持 head；Android on-device 已验证 nlc_open 不保留 head 指针）。
- **接线**：`ShellConfig.swift` 加可选 `contentKey`（非空才生效，镜像 Android）；`ShellViewController.decoderFor(_:)` = nil→Identity，非 nil→Native（iOS 静态链接，符号恒在，无需 Android 的 dlopen `isAvailable` 检查）；`WwwSchemeHandler` 每请求 `decoder.open` 得按文件解码器，`length = sourceLength - contentStart`，Range 全在内容空间，serving loop `seek(contentStart+start)` 读、`decode(at: 内容偏移)`，`defer close()`。Range 语义与 test-mobile.js 的 `blob+header+offset`/`nlc_decode(d, offset,…)` 逐字对齐。
- **链接**（`ios/Shell.xcodeproj/project.pbxproj`）：加 `NlCrypto.xcframework`（wrapper.xcframework，path=Vendor/…，sourceTree=SOURCE_ROOT）到 Frameworks build phase + Vendor group + `NativeContentDecoder.swift` 进 Sources。**静态 `.a` 折进可执行文件**：`nm Shell` 见 `_nlc_probe_size/_nlc_header_len/_nlc_open/_nlc_decode/_nlc_free` 五符号；**无 `$APP/Frameworks`**，CI 的 no-embedded-frameworks 断言仍成立。
- **CI**（`build-shells.yml`）：iOS job 加 `Pull the decoder libraries`（原缺失；本机能构建是因 ios/Vendor 本地已 pull，CI 里 gitignore 不存在会失败）；no-embedded-frameworks 断言处加注释说明静态链接共存理由。
- **pin**（`scripts/pull-decoder.js`）：DEFAULT_VERSION 0.3.0→**0.4.0**；本机跑通（android 三 ABI + ios xcframework 全暂存）。
- **自检**：Debug+Release `xcodebuild -sdk iphoneos CODE_SIGNING_ALLOWED=NO` 均 **BUILD SUCCEEDED**；本地复跑 CI iOS 全部断言通过（no frameworks/no symlinks/XML plist/executable bit）。清 build 后 pull→build 重跑仍绿。
- **待办**：CI 全绿需 push（用户动作，见 P2）；iOS 模拟器实跑解密留 P4（本机无 runtime，尽力）。

### P2 · 壳模板发布 — ⏸ 等待用户闸门（改动已提交，未 push）

- `npm/package.json` 版本已 bump 0.1.0→**0.2.0**。manifest schema 保持 1（contentKey 是 shell-config 可选字段、解码器烤进二进制，`make-manifest.js` SCHEMA_VERSION=1 不动）。
- **已提交**：Studio-Shell `master` 上 commit **ea37f57** `feat(ios): decode encoded payloads with the prebuilt library`（9 文件，仅 add 自己改动，保密 message）。**未 push**（按用户选择，push 由用户做）。
- **已 push**（用户授权）：`d9c227e..ea37f57` → origin/master，触发 build-shells run **30067500449 全绿**（android + ios 两 job success）。
- **产物已验证带解码器**（发布前强保险，外部工具而非仅信 CI 断言）：下载该 run 产物，`nm` 确认 iOS release `Shell.app/Shell`（arm64）含 5 个 `nlc_*` 符号 + 无嵌入式 framework；Android release APK 三 ABI 的 `libnlcrypto.so` 全在。
- **剩余用户动作（唯一发布闸门，2FA）**：`cd Studio-Shell/npm && npm publish`——`prepublishOnly` 自动 `pull-prebuilds`（下载该 run 模板）+ `make-manifest`（schema 1）。发布 `@narraleaf/studio-shell@0.2.0` 后 P3 解除阻塞。

> **P2 后续（用户已完成）**：Studio-Shell 已 push、build-shells CI 全绿、`@narraleaf/studio-shell@0.2.0` 已 `npm publish`（npm dist-tag latest=0.2.0 实测）。SIGKILL 修复也已发 `@narraleaf/encryption@0.4.1`（npm latest=0.4.1）。P2 闸门解除。

### P3 · Studio 翻密文 — ✅ 完成（2026-07-24）

前置实证：`@narraleaf/encryption@0.4.1` = 0.4.0 + 桌面 darwin 重签，`native/{mobile,core,aes}.c` **逐字节未变**；加密仓 `test:mobile` **19/19**（addon `encrypt`↔编译自同源的移动解码器）→ Studio 0.4.1 的 `encryptBuffer` 密文可被壳 0.2.0 的 0.4.0 解码器解开。升级 0.4.1 后之前 SIGKILL 的桌面 sealed 测试现 **11/11 绿**（darwin-arm64）。

- **pin**：`package.json` `@narraleaf/studio-shell` 0.1.0→**0.2.0**（密文唯一版本闸门）；已安装模板 `nm`/`unzip` 实测 iOS 5 符号 + Android 三 ABI `.so`，schema 仍 1。
- **key 解析**：`encryptionKey` 从「仅 desktop」扩到 `desktop || mobile`（`resolveEncryptionKey` 内部按 `encryptAssets` 判定）；新增中性日志「protecting the mobile payload」。
- **逐文件保护**（`runMobileRepack.ts`）：`siteEntries` 改 async，有 key 时**顺序**读+`encryptBuffer` 成 buffer 条目（含 index.html override；全保护不变量），无 key 保持 stream；只算一次供 android/ios 复用。`contentKey` 入 `GameBuildWorkerMobileJob`+`MobileShellConfigV1`，经 `buildMobileJob` 从 `encryptionKey` 注入。**shell-config 在 wwwRoot 外，天然明文**。`buildWorker` externals 加 `@narraleaf/encryption`（原生 addon 不可 bundle；构建实测 externalize）。
- **撤「暂不适用」**：console + preflight finding + `mobile-unprotected` union + i18n(en/zh) 全删，无残留引用。**web+key 硬 throw 未动**（未碰 compiler）。
- **验证**：新增密文测试（Studio `isProtectedPayload` + 外部 `unzip` oracle）；main/shared typecheck OK；mobile+build+compiler **21 文件 183 passed / 7 skipped**；`yarn build:main` 绿。

### P4 · 端到端验证 + 保密审计 — ✅ 完成（含 iOS 模拟器实机解密）

1. **加密产物**：`runMobileRepack` 用**真实 0.2.0 模板** + 真 key 产 APK → **外部 `unzip`** 读回 www 载荷**非明文**（不含明文串）、`isProtectedPayload`=真、shell-config 明文 JSON 含 `contentKey`、schema 1、APK v2 签名验证通过。✅
2. **非加密**：无 key `unzip` 读回**逐字节明文**、`isProtectedPayload`=假、shell-config 无 contentKey。✅
3. **web + 桌面回归**：compiler 11/11（含 sealed）；web+key 硬 throw 未变。✅
4. **Android CI oracle**：壳 build-shells CI 全绿；Studio `androidSdkOracle` 需 SDK，本机跳过、CI 覆盖。
5. **保密审计**：两公开仓全 diff **零机制词汇**（逐行扫描通过）。✅
6. **外部 oracle**：系统 `unzip`（非 Studio 自家解析器）。✅
7. **iOS 模拟器实机解密 — ✅ 已跑（2026-07-24，iOS 18.3.1 iPhone 16 模拟器）**：装 runtime，为 simulator slice 构建壳（fat x86_64+arm64，`nm` 见 5 符号），注入加密 www + 明文 shell-config，三变体实机截图：
   - **正确 key + 全加密载荷** → WebView 渲染出**解码后**的绿屏 "DECODED PAYLOAD"（明文只在正确解码时出现）→ Swift `NativeContentDecoder`+`WwwSchemeHandler` 运行时解码正确。
   - **错误但格式合法 key** → 白底**乱码**（非明文、非绿）→ 解码真实依赖 key（符合 CTR 无 MAC「wrong key 不可检测但不产明文」+ Android 先例）。
   - **明文文件 + config 带 key** → **空白**（`headerLen==0` → Swift 抛 `notEncoded` → `didFailWithError`）→ **fail-loud**，不静默服务明文/乱码，与 Android（404）语义一致。
   - **顺带验证跨版本栈**：壳二进制含 **0.4.0** 解码器（pull-decoder pin），载荷用 **0.4.1** `encryptBuffer` 加密 → 绿屏成功，运行时证实 0.4.1 加密↔0.4.0 解码兼容。测试用模拟器已删除。

**Studio 侧未提交**：10 文件（package.json / build-main.js / GameBuildManager.ts / runMobileRepack.ts(.test) / protocol.ts / mobileShellManifest.ts / gameBuild.ts / en·zh build.ts），待用户定夺提交方式。

**旁支（非本卡）**：全仓 CI `yarn lint` 另被**既有** renderer/NLR 缺口阻塞（M5 用 narraleaf-react 0.16 API，pin 仍 ^0.15）——已开后台任务，修 = bump `^0.16.0` + 全量复验。

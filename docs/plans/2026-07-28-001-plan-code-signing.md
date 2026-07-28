---
title: "feat: 游戏产物代码签名（Windows / Linux / Android / iOS）"
type: feat
status: planning
date: 2026-07-28
branch: feat/code-signing
worktree: D:/Temp/nls-codesign
---

# feat: 游戏产物代码签名

> **一句话总览**：构建管线已经能在 Windows 宿主上产出全平台的加密产物，但每一份产物
> 都是未签名的。本轮给 Studio 加一个**机器级凭据保险库**，让作者用自己的证书/密钥
> 给自己导出的游戏签名：Windows 走 Authenticode（三种凭据来源），Android 走 release
> keystore 的 APK v2，iOS 走捆绑的 zsign 重签，Linux 走校验和 + 可选 GPG 分离签名。
>
> **关联**：[2026-07-15-002 移动端构建管线](2026-07-15-002-feat-mobile-build-pipeline.md) §7
> 「签名与安装的现实边界（写给未来批次）」——本计划就是那个未来批次。
> [2026-07-15-001 构建弹窗重构](2026-07-15-001-feat-production-build-dialog.md) 定义了
> 本轮要扩一个 section 的四段式弹窗。

## 0. 拍板记录（2026-07-28）

| 问题 | 裁决 |
| --- | --- |
| 签名范围 | **只签用户的游戏产物**。Studio 自身继续 ships unsigned（`electron-builder.yml` 里那几条依赖签名的 fuse 保持关闭）。 |
| iOS 实现路线 | **捆绑 zsign 二进制**（MIT，v1.1.1 起上游发布全平台预编译）。不自研 Mach-O / CodeDirectory / CMS。 |
| Windows 凭据来源 | **三种全要**：Windows 证书存储（硬件 token / HSM）、PFX 文件 + 密码、Azure Trusted Signing。 |
| Linux 档位 | **SHA256SUMS + 可选 GPG 分离签名**。不做 AppImage 内嵌签名。 |

macOS（宿主与目标）不在本轮，由用户在 Mac 设备上另行接续。

## 1. 目标与非目标

### 目标

- 一套**机器级**签名凭据保险库：导入 / 查看 / 删除，密码经 Electron `safeStorage` 加密落盘。
- 工程里只存**凭据引用（id）**，不存任何密钥或密码——工程现在会进版本控制。
- 构建对话框新增 Signing 段：按平台挑凭据，preflight 在按下构建前就把问题说清楚。
- Windows 目标产出通过 `signtool verify /pa` 的 Authenticode 签名产物。
- Android 目标可用作者自己的 release keystore 签名（保留 debug 身份为默认）。
- iOS 目标产出用作者 Apple 身份签名的 IPA（可旁加载安装）。
- Linux 目标产出 `SHA256SUMS`，并在配置了 GPG 身份时产出 `.asc` 分离签名。

### 非目标（本轮明确不做）

- **macOS 目标签名与公证**（`codesign` + notarytool 只在 mac 宿主可用）。
- **AAB / Google Play 上架**。Play 只收 AAB，而从模板 APK 造 AAB 需要 proto 格式资源
  （aapt2），而 aapt2 属于 §2 里禁止再分发的 Android SDK 组件。APK release 签名的价值
  在于侧载、itch.io、以及非 Play 应用商店——这一点必须写进 UI 文案，不能让人以为
  签了名就能上 Play。
- **APK Signature Scheme v3 / v4**（v2 对 minSdk 26 足够；v3 只在密钥轮换时有意义）。
- **在 Studio 内生成 release keystore**（只支持导入；生成需要写 PKCS#12 导出，留 backlog）。
- **AppImage 内嵌签名**、deb/rpm 仓库签名。
- **Studio 自身的发布签名**。

## 2. 硬约束

1. **凭据永不进工程目录**。工程现在受版本控制管理（见 `src/main/app/application/managers/vcs/`），
   任何密钥、密码、证书文件都只能落在 `userData` 下的保险库里；工程配置只存 id 字符串。
2. **离线约束在本轮被有条件突破**，必须显式告知用户：Authenticode 的 RFC3161 时间戳、
   Azure Trusted Signing、以及 electron-builder 在宿主没有 Windows SDK 时下载它自己的
   signtool bundle，都需要网络。未配置签名的构建路径保持完全离线。
3. **保密（延续）**：签名代码不得触碰、不得描述资产保护机制。签名发生在 seal 之后、
   或在打包器内部，两条链路互不引用。
4. **i18n**：所有新文案进 `src/shared/i18n` 的 en + zh 双 catalog。
5. **不用 ALL-CAPS 文案，不向用户暴露内部 id**（凭据在 UI 里用 label 显示）。
6. **不在日志里打印任何密码、私钥、p12 内容**。worker 日志经 `emitWorkspaceConsoleLog`
   直达渲染层控制台，是最容易泄漏的一条路。

## 3. 现状盘点（本轮要接进去的既有骨架）

| 位置 | 现状 |
| --- | --- |
| `src/main/app/application/managers/build/GameBuildManager.ts:597` | `const hasSigningIdentity = false;` + 注释「未来签名批次翻成 true」。它经 `gameFusesForPlatform`（`:122-132`）门控 `enableEmbeddedAsarIntegrityValidation`。 |
| `src/main/buildWorker/runGameBuild.ts:47` | `builderConfiguration()`——electron-builder 的配置在这里**程序化**生成，没有 per-project 的 yml。桌面签名就加在这。 |
| `src/main/buildWorker/protocol.ts:27-46` | `GameBuildWorkerTarget`。签名参数加在这里，由 main 预解析后以纯 JSON 传入（`:10-14` 明确了这条纪律）。 |
| `src/main/buildWorker/mobile/apkSigningV2.ts:190` | `signApkV2` 已经是完整的纯 TS v2 签名器，含自校验器 `:276`。只缺「换一把 release 私钥」。 |
| `src/main/app/application/managers/build/mobileSigningIdentity.ts:48` | `resolveMobileSigningIdentity(userDataDir)` → `{privateKeyPem, certificateDerBase64}`。release 路径要产出同形状的东西。 |
| `src/main/buildWorker/mobile/runMobileRepack.ts:190` | 未签名 IPA 写盘处，iOS 签名的插入点。 |
| `src/shared/types/gameBuild.ts:105-107` | preflight 已有 `unsigned` / `unsigned-android` / `unsigned-ios` 三个码，UI 与 i18n 都在（`en/build.ts:126-128`）。本轮把它们变成「未配置签名时才报」。 |
| `src/main/buildWorker/pluginBuildDependencies.ts:99` | 「下载 → 校验 sha256 → 暂存 → 原子改名 → 离线可手放」的既有范式，zsign 的 vendoring 照抄。 |
| `src/main/buildWorker/mobile/androidSdkOracle.test.ts` | 环境门控的外部 oracle 测试范式（`REQUIRE_ANDROID_SDK_ORACLE=1` 在 CI 上把 skip 变成 fail）。签名验收测试照抄。 |
| 全仓 | **没有任何 `safeStorage` / keytar / 凭据存储**。现有秘密都是 `userData` 下 `0600` 的明文文件（`packKeyService.ts:17`、`mobileSigningIdentity.ts:64`）。 |

**本机可用的验收 oracle**（这决定了哪些结论我能自己证、哪些只能推断）：

- `signtool.exe` — `C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\`。
  `signtool verify /pa /v` 是 Windows 侧的权威判决，`Get-AuthenticodeSignature` 是第二路。
- `openssl` — `C:\Strawberry\c\bin\openssl.exe`。造测试证书链、验 PKCS#7/CMS。
- `keytool` — Adoptium JRE 17。造真实的 PKCS#12 / JKS keystore 当被测输入。
- Python 3.10 + `cryptography` — 已有的自写 APK v2 验签器（见 [[windows-mobile-packaging-verified]]）。
- **没有** `gpg`（Linux 验收前要装一个）、**没有** Android SDK（`apksigner` 只能靠 CI）、
  **没有** iOS 设备（真机安装无法本机验证）。

## 4. 架构

### 4.1 凭据保险库（机器级）

新目录 `<userData>/signing/`：

```
signing/
├─ credentials.json        # 元数据 + safeStorage 加密后的密码（base64），0600
└─ material/<id>/          # 导入时复制进来的密钥材料，0600
     ├─ cert.p12
     └─ profile.mobileprovision
```

- 新代码 `src/main/app/application/managers/security/signingVault.ts`，风格照
  `packKeyService.ts`（read-or-create、`mode: 0o600`）。
- 命名空间登记进 `src/shared/types/constants.ts:16-25`。
- **密码用 `safeStorage.encryptString`**（Windows 上是 DPAPI，绑定当前用户账户）。
  `safeStorage.isEncryptionAvailable()` 为 false 时**拒绝落盘密码**，preflight 报
  `signing-secret-unavailable`，用户可以每次构建时临时输入。
- 导入的密钥材料**复制**进 `material/`，不引用原路径——否则用户挪一下文件构建就炸，
  而且原路径可能在工程目录里（会进 VCS）。
- 绝不进 `GlobalStateManager`：那是明文 electron-store，且 `app.globalState.getAll`
  会把整个 store 广播给渲染层。

凭据类型（`src/shared/types/signing.ts`，discriminated union）：

| kind | 字段 | 秘密字段 |
| --- | --- | --- |
| `windows-pfx` | `file` | `password` |
| `windows-store` | `subjectName?` / `sha1?` | 无（私钥在 token/HSM 里） |
| `windows-azure` | `endpoint`, `codeSigningAccountName`, `certificateProfileName`, `publisherName` | Entra 凭据走宿主环境变量，Studio 不代管 |
| `android-keystore` | `file`(.p12/.jks/.keystore), `alias` | `storePassword`, `keyPassword` |
| `ios-apple` | `p12File`, `provisioningProfileFile` | `p12Password` |
| `linux-gpg` | `keyId`, `gpgPath?` | 无（走宿主 gpg-agent） |

IPC 面（新 handler 文件 `managers/window/handlers/signingAction.ts` + `ipcEvents.ts` 常量
+ preload 接口）：`signing.list` / `import` / `remove` / `inspect`（读证书主题、有效期、
mobileprovision 的 team/appId/设备/到期日）。

### 4.2 工程侧引用

`src/renderer/lib/workspace/project/configuration.ts` 新增：

```ts
export type SigningConfiguration = {
    windows?: string;   // credential id
    linux?: string;
    android?: string;
    ios?: string;
};
```

挂在 `ProjectAppConfiguration.signing?`，配 `DEFAULT_SIGNING_CONFIGURATION` 与
`normalizeSigningConfiguration`（照 `normalizeBuildConfiguration` 的写法丢弃未知键）。
`ProjectService` 加一对 getter/updater（照 `:191-216` 的 security 那对）。

**跨机器打开工程时 id 悬空是正确行为**：preflight 报 `signing-credential-missing`，
提示在这台机器上导入同名凭据即可。

### 4.3 worker 协议与进度

- `GameBuildWorkerTarget` 加 `signing?: ResolvedSigningMaterial`（main 侧解密后传入的纯
  JSON，与既有 `GameBuildWorkerMobileJob.android.signingIdentity` 同纪律）。
- **不新增 `GameBuildStatus`**。桌面签名发生在 electron-builder 内部，本来就在 `packaging`
  阶段；移动/Linux 签名是 worker 内的后置步骤，同样在 `packaging` 内。进度靠既有的
  `log` 流（`emitWorkspaceConsoleLog`）表达。

### 4.4 UI

`BuildDialog.tsx:48` 的 `SECTIONS` 增加第五段 `"signing"`，`BuildPreflightSection`
（`gameBuild.ts:76`）同步扩。该段每个启用的平台一行：凭据下拉 + 「导入…」按钮 +
一行只读摘要（证书主题 / 到期日）。导入走弹窗，落到保险库。

保险库的管理（列表、删除）也放在这一段——不另开 Settings 页。`appSettings.ts` 的注册表
是扁平 key-value 模型（`models.ts:68-133`），塞不下一个凭据管理器。

### 4.5 preflight 新码

| code | severity | 含义 |
| --- | --- | --- |
| `signing-credential-missing` | error | 工程引用的凭据在本机不存在 |
| `signing-credential-expired` | error | 证书已过期 |
| `signing-credential-expiring` | warning | 30 天内过期 |
| `signing-secret-unavailable` | error | `safeStorage` 不可用，密码取不到 |
| `signing-tool-missing` | error | 配了但宿主缺工具（gpg / Azure 的 TrustedSigning 模块） |
| `signing-host-unsupported` | error | 宿主签不了该目标（本轮只有 macOS 会命中） |
| `signing-needs-network` | warning | 该次签名会联网（时间戳 / 云签名 / 下载 signtool） |
| `signing-android-not-play` | warning | 签名的是 APK，Play 只收 AAB |
| `signing-ios-profile-mismatch` | error | bundle id 与描述文件的 application-identifier 不匹配 |

既有的 `unsigned` / `unsigned-android` / `unsigned-ios` 改为**仅在该平台未配置签名时**才发。

## 5. 各平台方案

### 5.1 Windows — Authenticode

electron-builder 26.9.0 原生支持全部三种凭据来源，映射如下（`winOptions.d.ts:27,32,67-109`）：

| 凭据 kind | 映射 |
| --- | --- |
| `windows-pfx` | `win.signtoolOptions.certificateFile` + `certificatePassword` |
| `windows-store` | `win.signtoolOptions.certificateSubjectName` 或 `certificateSha1` |
| `windows-azure` | `win.azureSignOptions.{endpoint, codeSigningAccountName, certificateProfileName, publisherName}` |

外加 `rfc3161TimeStampServer`（默认 `http://timestamp.digicert.com`，可在凭据上覆盖）。

**signtool 从哪来**：`app-builder-lib/out/toolsets/windows.js` 的 `getSignToolPath` 优先读
`SIGNTOOL_PATH` 环境变量，否则下载它自己的 `windows-kits-bundle-10_0_26100_0.zip`。
所以 Studio 要写一个 **signtool 发现器**（`C:\Program Files (x86)\Windows Kits\10\bin\<最高版本>\<宿主 arch>\signtool.exe`，
另接受 `SIGNTOOL_PATH` 覆盖），有则设进 worker 环境 → 离线可签；无则 preflight 发
`signing-needs-network`。

**`hasSigningIdentity`（`GameBuildManager.ts:597`）改为 per-target 计算**，Windows 目标
配了凭据即为 true → `enableEmbeddedAsarIntegrityValidation` 打开。这是签名带来的真实
安全收益，不是顺手改的。

**已知泄漏点（记录，不修）**：electron-builder 把 PFX 密码作为 `/p <password>` 传给
signtool 的命令行，同用户的其他进程可以在进程列表里看到。这是 signtool 的接口形状决定的，
上游无解；Azure 与证书存储两条路径没有这个问题。文档里写明。

**验收**：`signtool verify /pa /v <game>.exe` 与 NSIS 安装器都要通过；
`Get-AuthenticodeSignature` 的 `Status` 为 `Valid`；改一个字节后必须变 `HashMismatch`
（反向对照，防止断言空转）。

#### 5.1.1 本机实测结论（2026-07-28，orchestrator 亲验）

用 openssl 造的 RSA-3072 代码签名证书（EKU=codeSigning）签了一份真实的
`electron.exe` 副本，走的是 SDK 10.0.26100 的 `signtool.exe`：

- `signtool sign /fd SHA256 /f cs.pfx /p … /tr http://timestamp.digicert.com /td SHA256`
  成功，exit 0，且**真的挂上了 RFC3161 时间戳**——`TimeStamperCertificate` 是
  `DigiCert SHA256 RSA4096 Timestamp Responder 2025 1`。时间戳这条联网路径在本机通。
- 自签根不受信时 `Get-AuthenticodeSignature` 的 `Status` 是 **`UnknownError`**（不是
  `Valid`），但 `SignerCertificate` 正确填充。**测试用自签证书永远到不了 `Valid`**，
  所以测试断言要断的是 signer 主题 + 非 `HashMismatch`，把 `Valid` 留给真实证书的手测。
- 翻掉 `0x2000` 处一个字节后 `Status` 变 **`HashMismatch`**——与「根不受信」是两个
  可区分的状态，反向对照成立。

### 5.2 Android — release keystore

- ✅ **已完成**：`src/main/buildWorker/mobile/keystoreReader.ts` + `rc2.ts`（commit `120d0966`）。
  读 PKCS#12 与 JKS，产出 `SigningIdentity & { certificateChainDerBase64[], alias }`，
  链是 leaf-first 且由私钥与签发关系**重新推导**，不信文件顺序。RC2 按 RFC 2268 自写
  （8 组官方向量双向对拍），未引 node-forge。
  - **⚠ 格式必须按魔数判定，不能按扩展名**：Android Studio 把 PKCS#12 写进名为 `.jks`
    的文件里，按扩展名分派会把最常见的那种情况路由错。文件选择器要同时接受
    `.jks/.keystore/.p12/.pfx`，且**不得**因扩展名拒绝。
  - **⚠ `signApkV2` 的接口要改成收 leaf-first 的证书链**，`verifyApkV2` 比对
    `certificates[0]` 而不是「那张证书」。
  - 已知无解的歧义：口令错与文件损坏**在构造上不可区分**（都只是 MAC 校验失败）。
    提示语以口令为先、损坏为次，不靠「跳过完整性校验继续解析」去编一个区分依据。
  - 已知跨工具风险：PBES2 按 UTF-8 哈希口令，PBES1 与 MAC 按 UTF-16BE——
    非 ASCII 口令在 OpenSSL 与 Java 写出的库之间可能对不上。值一句 UI 文案。
- `signApkV2`（`apkSigningV2.ts:190`）目前只带单张自签证书；扩成接受证书链。
- `GameBuildManager.ts:855` 的身份解析分叉：配了 release 凭据用它，否则维持 debug 身份。
  **必须在日志里说清换了签名身份**——同包名换签名会导致设备上「应用未安装」，用户需要先卸载。
- v2-only 保持不变（minSdk 26）。

**验收**：`keytool -genkeypair` 造 keystore（PKCS#12 与 JKS 各一）→ 构建 → 自写
`verifyApkV2` 绿 + 载荷翻一字节必须 MISMATCH；CI 上 `apksigner verify --min-sdk-version 26 --verbose`
断言签名者证书就是 keystore 里那张（`.github/workflows/ci.yml` 已有 SDK oracle 位）。

### 5.3 iOS — 捆绑 zsign

- **供给**：`project/build/prepare-codesign-tools.js`（照 `prepare-mobile-shell.js`），在
  **Studio 构建期**从 pin 死的 zsign release 下载对应宿主的资产、比对写死的 sha256、
  解包到 `resources/codesign/<platform>/`；`electron-builder.yml` 的 `win`/`mac`/`linux`
  各自只带自己那份。dev 模式落 `.dev/cache/codesign/`。
  → **用户运行时零下载、零工具链**，与移动壳模板同一条纪律。
  → pin 版本：**zsign v1.1.1（2026-07-16）**，上游 release 附 `SHA256SUMS.txt`。
  → MIT 许可，可再分发；`LICENSE` 与出处随 `resources/codesign/` 一并附上。
- **调用**（`runMobileRepack.ts:190` 之后）：
  `zsign -k <p12> -p <password> -m <profile> -b <bundleId> -o <signed.ipa> <unsigned.ipa>`。
  密码经 stdin 或临时文件传，**不进命令行**（避免 §5.1 那个泄漏点在我们自己手里重演）——
  zsign 的 `-p` 只收命令行，所以这里的缓解是**只在必要时传**，并评估 `-k` 直接给 PEM
  私钥 + `-c` 给证书（我们已经能读 p12）从而完全不传密码。**这条要在实现时实测确认。**
- **mobileprovision 解析（TS，新 `provisioningProfile.ts`）**：文件是 CMS 包裹的 XML plist；
  取出 eContent 后用既有 `plist.ts` 解析。用于 UI 摘要与 preflight 的 bundle id 匹配检查。
- 产物落地后仍要跑 `zsign -C`（检查证书有效性）作为自检。

**验收**：`openssl cms -verify` / `openssl pkcs7` 验签名结构；从签好的 IPA 里取出
`_CodeSignature/CodeResources` 与 `embedded.mobileprovision` 断言存在且内容正确；
zsign `-x` 导出元数据交叉核对。**真机安装本机无法验证，明确留给用户。**

#### 5.3.1 本机实测结论（2026-07-28，orchestrator 亲验）

用真实的 `@narraleaf/studio-shell` iOS 模板（`Shell.app`，arm64 Mach-O，
`CODE_SIGNING_ALLOWED=NO` 编出、无 `LC_CODE_SIGNATURE`）拼出未签名 IPA，
用 openssl 造的测试身份跑通了全流程。逐条结论：

- **zsign-windows-x64 完全自包含**：4.5 MB 单文件，`objdump -p` 只引用
  KERNEL32 / SHELL32 / SHLWAPI / WS2_32 / CRYPT32 / USER32 / ADVAPI32——
  OpenSSL 与 CRT 都静态链接，无 VC++ 运行库依赖。捆绑代价干净。
- **Linux 宿主必须用 `zsign-linux-musl-static.tar.gz`（2.0 MB）**，
  不能用 `zsign-linux-x86_64.tar.gz`（249 KB，动态链接宿主 libssl）。
  **macOS 只有 arm64 资产，没有 x64**——mac 批次要么自己编，要么只支持 Apple Silicon。
- **签名产物结构完整**：CodeDirectory `version=0x20400`、SHA-256（hashType=2）、
  4 KiB 分页、53 个 code slot 覆盖到 `codeLimit=216336`（签名段之前的全部字节）、
  ident 是改写后的 bundle id；另有 Requirements、Entitlements（XML）、
  EntitlementsDER、CMS 五个 slot。CMS 是标准 PKCS#7 SignedData，
  含完整证书链、sha256WithRSAEncryption，签名属性里有 Apple 的
  `1.2.840.113635.100.9.2`（CDHashes）。
- **entitlements 由描述文件自动派生**，Studio 不需要自己撰写。
- **分页哈希确实覆盖载荷**：自写校验器重算 53 页全部匹配；
  翻掉 `0x400` 处一个字节后 page 0 立刻 MISMATCH。断言不是空转。
- **⚠ p12 必须自带签发链**。只给叶证书时 zsign 报
  `Unknown issuer hash 0x…! No embedded WWDR intermediate matches and the p12
  carries no usable CA chain.` 并以 exit 255 失败。真实 Apple 证书能过是因为
  zsign 内嵌了 WWDR 中间证书，但**用户从钥匙串导出时漏掉中间证书一样会炸**——
  preflight 必须提前检查链是否完整，并把这条错误翻译成可操作的中文/英文提示。
- **`-c` 传 PEM 证书链没用**：`-k leaf.key -c <leaf+ca bundle>.pem` 依然报同一个
  链缺失错误。链只认 p12 这一条路。
- **✅ 密码可以不上命令行**：无口令 p12（`openssl pkcs12 -export -passout pass:`）
  配合**不带 `-p`** 的调用签名成功。所以 S4 的做法是：用我们自己的 PKCS#12 读取器
  读用户的 p12 → 在临时目录写一份 0600 的临时无口令 p12 → 调 zsign → 用后即删。
  这样 §5.1 里 signtool 那类「密码出现在进程命令行」的泄漏在 iOS 侧不重演。
  代价是需要一个最小 PKCS#12 **写入器**（可用未加密 keyBag，比读取器简单得多）。
  **兜底**：若临时 p12 方案在实现中被证明脆弱，退回 `-p` 并按 §7.3 记录暴露面。
- 退出码可靠：成功 0，失败 255，失败时 stdout 有 `Signed Failed!`。

### 5.4 Linux — 校验和 + 可选 GPG

- 构建结束后对**所有**产物（不只 Linux 的）生成 `SHA256SUMS`，格式与 `sha256sum` 一致。
- 配了 `linux-gpg` 凭据时，对每个产物跑
  `gpg --batch --yes --detach-sign --armor --local-user <keyId> <artifact>` → `<artifact>.asc`，
  并对 `SHA256SUMS` 也签一份。密钥留在宿主 gpg-agent 里，Studio 不碰私钥。
- gpg 发现器：`GNUPG_PATH` 环境变量 → PATH 上的 `gpg`/`gpg2` → 常见安装目录。
- UI 与文档里**说清这不是 OS 强制的代码签名**，是分发完整性；Linux 不会因为没签名而拦你。

**验收**：造一把测试密钥 → 构建 → `gpg --verify <artifact>.asc <artifact>`
通过；改一字节必须 BAD signature。

#### 5.4.1 本机实测结论（2026-07-28，orchestrator 亲验）

用隔离的 `GNUPGHOME=/d/Temp/gpgprobe`（不碰用户真实钥匙串）造了一把 ed25519 密钥，
对前面签过的 `probe.exe` 做分离签名：完好文件 `Good signature`，翻过字节的
`BAD signature`。反向对照成立。三条会改实现的发现：

- **本机其实有 gpg，但 `Get-Command gpg` 查不到**——它是 Git for Windows 自带的，
  只在 Git Bash 的环境里可见。所以发现器**不能只查 PATH**。
- **也不能硬编码 `C:\Program Files\Git`**：这台机器上 Git 装在 `D:\Program\Git`。
  正确做法是先定位 git 本体（`where git` / `git --exec-path`）再推 `usr/bin/gpg.exe`，
  同时探 Gpg4win 的 `%ProgramFiles(x86)%\GnuPG\bin\gpg.exe`，以及 PATH。
- **⚠ Git 自带的是 MSYS 构建，路径语义和原生 Windows 不同**：给它 Windows 风格的
  `GNUPGHOME`（`D:\Temp\…`）会报 `':' are not allowed in the socket name`，并且它把该
  路径当成相对 cwd 解析。结论：**Studio 绝不要设 GNUPGHOME**（用作者默认的钥匙串就好）；
  若将来非设不可，必须转成 MSYS 风格。**优先挑 Gpg4win 的原生 gpg，Git 的作为兜底。**
- **带口令的密钥需要 pinentry**。从 utility process 里弹 GUI pinentry 不可靠。
  本轮的立场：要求密钥要么无口令、要么已在 gpg-agent 里解锁；签名失败时**把 gpg 的
  stderr 原样呈给作者**，而不是吞掉换成我们自己的猜测。

## 6. 里程碑

| # | 内容 | 状态 | 合入门槛 |
| --- | --- | --- | --- |
| **S0** | 凭据保险库：类型、`signingVault.ts`、safeStorage 落盘、IPC 面。 | ✅ `dd5a91fc` | 已验收：orchestrator 另写三个独立探针（密码任何编码下不落盘、离开保险库的东西都不带它、主进程仍可取回、删除抹掉私钥、手改索引想跳出目录被拒） |
| **S0.5** | `keystoreReader.ts` + `rc2.ts`：PKCS#12 / JKS 读取。 | ✅ `120d0966` | 已验收：openssl 本机开不了 RC2-40，改用 keytool 造真 RC2-40 库并以其 SHA-256 指纹当独立 oracle，逐位一致 |
| **S4a** | zsign vendoring：构建期下载校验、`resources/codesign/`、运行时解析。 | ✅ `41c732f6` | 已验收：落地 exe 与手工核验的资产 sha256 相同、二次运行 no-op、改坏一字节会重新拉取、排除 glob 只吃 codesign 树 |
| **S1a** | 工程侧 `signing` 配置、worker 协议、凭据解析、preflight 新码、i18n。 | ✅ `20233d3e` | 已验收：三个 tsc 项目干净、失败即抛不降级、种类不匹配被拦、全仓确认无密码流向控制台 |
| **S1b** | BuildDialog Signing 段、凭据导入、PKCS#12 证书检视。 | ✅ `1736dc00` | 已验收：到期码不再是黑的（拿一张 2025-01 就过期的证书验过），无口令时仍拒绝猜测 |
| **S2** | Windows Authenticode：三种凭据映射、signtool 发现器。 | ✅ `72d4c7b9` | 已验收：真 exe 经 `signtool verify` 与 `Get-AuthenticodeSignature`，翻字节 → `HashMismatch` |
| **S5** | SHA256SUMS（无条件）+ GPG 分离签名 + gpg 发现器。 | ✅ `72d4c7b9` | 已验收：`gpg --verify` 通过 + 翻字节 BAD |
| **S3** | Android release keystore：证书链、身份分叉、换签名警告。 | ✅ `36f5d6b4` | 已验收：用我自己造的 keystore，v2 块里的证书指纹与 keytool 逐位一致；翻字节被拒 |
| **S4b** | iOS：zsign 调用、临时无口令 p12、描述文件解析。 | ✅ `36f5d6b4` | 已验收：产物交给我自己写的 `verify.js`，53 页全中；翻字节 page 0 立刻断 |
| **S6** | 端到端手测（用 `D:/Temp/nls-sign-probe/WinMobileProbe`）、文档、handoff 给 mac 批次。 | 🔄 | orchestrator 亲眼验收，不认代理报告 |

### 收尾时的三处订正（orchestrator 亲手改，非代理产出）

1. **preflight 与签名步骤各有一份 gpg 发现器**，preflight 那份找不到 Git for Windows 里的 gpg
   —— 在这台机器上它会以 error 级挡住一个其实签得成的构建。已合并成一份。
   教训通用：**同一个问题有两处答案，迟早会答得不一样**，而且不一致的那一天多半是在用户机器上。
2. **证书到期检查形同虚设**：它不带口令去看 PKCS#12，只会得到「格式不支持」然后闭嘴——
   一张已经过期的证书会一声不吭地放过去。现在它解封凭据再读。
3. **iOS 工具路径改由 manager 解析并写进协议**。代理为了不碰协议，在 worker 里重新推导了
   `resources/` 的位置；那段推导的**打包态分支恰恰是本机无法验证的那一支**，一旦打包布局变了，
   坏的会是发布版而不是任何一次测试。协议里本来就写着「所有路径由 manager 解析后再 fork」。

### 两处采纳的代理判断

- **不做 `zsign -C` 事后自检**：它的帮助里写着要查 OCSP 吊销状态，也就是每次签名都要联网，
  而且没人宣告过。离线替代已就位（描述文件到期检查 + 证书主题/有效期进日志）。
- **只签 sha256**，不跟 electron-builder 默认的 sha1+sha256 双签：sha1 那一趟要多一次
  非 RFC3161 的时间戳往返，换来一个 Windows 早就不信的签名。

## 7. 风险

1. **时间戳与云签名要联网**，破坏了移动构建管线立下的离线硬约束。缓解：只有配置了签名的
   目标才联网，preflight 提前告知（`signing-needs-network`）。
2. **Azure Trusted Signing 要求宿主自己装 `TrustedSigning` PowerShell 模块并配 Entra 环境
   变量**，Studio 不能代劳。preflight 检测模块是否存在，缺了就报 `signing-tool-missing`
   并给出安装命令（照 `build-dependency-unavailable` 的文案范式）。
3. **PFX 密码经 signtool 命令行泄漏**（§5.1）。上游无解，只记录。
4. **换 Android 签名身份会让老版本装不上**。必须是显式的、醒目的构建日志与 preflight 提示。
5. **iOS 真机安装无法在本机验收**——本轮能证明的上限是「结构正确、证书有效、描述文件匹配」。
   这条要如实写进交接，不能在 UI 里承诺「可安装」。
6. **zsign 是第三方二进制**。缓解：pin 版本 + 写死 sha256 + 构建期 vendoring（不在用户机器上
   下载）+ 附带 LICENSE。

## 8. 补充拍板（2026-07-28，实现前）

| 问题 | 裁决 |
| --- | --- |
| 下载并本机运行 zsign v1.1.1 | **批准**。pin 版本 + 对照上游 `SHA256SUMS.txt` 校验后才解包，校验和写死进 vendoring 脚本。 |
| PKCS#12 解析 | **自写解析器**，不引 node-forge。只覆盖 keytool 与 Android Studio 实际产出的算法组合，RC2 按 RFC 2268 实现。**已落地并验收**（见 §5.2）：openssl 在本机连 RC2-40 的库都打不开，所以我用 keytool 造了一个真 RC2-40 的 keystore，拿 keytool 自己报的 SHA-256 指纹当独立 oracle，与读取器提取的证书逐位一致，私钥也通过 `checkPrivateKey` + 真实签验。 |
| SHA256SUMS | **无条件生成**，覆盖该次构建的全部产物（不限 Linux）。

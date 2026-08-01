---
title: "feat: macOS 宿主的完整签名能力（macOS 目标签名 + 公证，以及从 Mac 驱动其余四个平台）"
type: feat
status: done
date: 2026-07-31
branch: feat/mac-code-signing
---

# feat: macOS 签名

> **一句话总览**：[2026-07-28-001](2026-07-28-001-plan-code-signing.md) 在 Windows 宿主上
> 建成了凭据保险库与 Windows/Android/iOS/Linux 四条签名链路，并把 macOS **显式排除**
> （"由用户在 Mac 设备上另行接续"）。本轮就是那个接续：补上 macOS 目标的 codesign +
> 公证，并把"从 Mac 宿主驱动其余四个平台"这件事验证到位。

## 0. 拍板记录（2026-07-31）

| 问题 | 裁决 |
| --- | --- |
| macOS 凭据种类 | **两种**：`macos-keychain`（钥匙串里的证书，Mac 上最常见的形态）与 `macos-apple`（.p12 文件）。对应 Windows 侧 store / pfx 的分法。 |
| 公证如何建模 | **不是第三种 kind，而是两种 kind 上的可选字段**。公证与"身份从哪来"正交，做成 kind 会变成 4 个 kind 描述 2 个决策，且工程指向"那个会公证的"时会连证书一起换掉。 |
| 公证凭据来源 | **只支持 App Store Connect API key（.p8 + keyId + issuerId）**。另一条路要 Apple ID + app-specific password，那是通往用户整个 Apple 账户的凭据；API key 是受限的、可单独吊销的，也是 Apple 与 electron-builder 都推荐的。 |
| 三个公证字段的完整性 | **全有或全无**，保险库在 import 时拒绝半填。每个字段单独可选，所以没有别的地方会拦住"填了两个"——而那毫无疑义是要求公证，接受它等于给作者一份签了名却悄悄跳过公证的凭据。 |

## 1. 目标与非目标

### 目标

- macOS 目标产出经 `codesign` 签名的 .app / .dmg，可选经 notarytool 公证。
- macOS 宿主能驱动既有四条链路：Windows Authenticode（走 osslsigncode）、Android
  release keystore、iOS zsign 重签、GPG 分离签名。
- 构建对话框的 Signing 段在 Mac 上列出全部五行，并对每一行给出**本机**的真实判决。

### 非目标

- **Mac App Store（MAS）签名与上架**。`mas` target 要另一套证书与描述文件，且 Studio
  产出的是独立分发的游戏。
- **Apple ID + app-specific password 公证路线**（见 §0）。
- **Studio 自身的发布签名**（沿用上一轮的立场）。
- **在 Studio 内申请/生成 Apple 证书**。只支持导入与选择。

## 2. 架构

### 2.1 凭据（`src/shared/types/signing.ts`）

`SigningPlatform` 增加 `"macos"`；`SigningCredentialKind` 增加两种：

| kind | 字段 | 秘密 | 映射 |
| --- | --- | --- | --- |
| `macos-keychain` | `identity` | 无（私钥在钥匙串里） | `mac.identity` |
| `macos-apple` | `p12File` | `p12Password` | `mac.cscLink` + `mac.cscKeyPassword` |

两者都可携带可选的 `notaryKeyFile` / `notaryKeyId` / `notaryIssuerId`。

**保险库改动**：material 字段过去一律必填（`requireString`），公证的 .p8 是第一个
"可选的密钥文件"。新增 `SIGNING_OPTIONAL_FIELDS` 统一 metadata 与 material 两张表的
可选集合，并加 `assertNotarizationComplete` 拦住半填。.p8 是私钥，与其他密钥材料一样
落 `material/<id>/` 且 0600。

### 2.2 worker 协议与 electron-builder 映射

`GameBuildWorkerTarget.signing` 从 `GameBuildWorkerWindowsSigning` 放宽成它与
`GameBuildWorkerMacSigning` 的并集，靠 `source` 区分（两个并集的 source 取值不相交），
`isMacSigning` 是判别式。`runGameBuild` 仍先看 `target.platform` 再读——一个落错平台的
块会往 macOS 配置里塞 `win` 段，那正是"悄悄什么都没签"的形状。

**两处不是默认值而是刻意声明的**（`macSigningConfiguration`）：

1. **未配置签名时 `mac.identity: null`**。留空的话 electron-builder 会去登录钥匙串里
   找证书并用找到的那张签——于是一台恰好装了证书的机器会产出一个 preflight 刚说过
   "未签名"的已签名产物，用的还是作者从未为这个工程选过的身份。
2. **`mac.notarize: false`**。公证完全由环境变量驱动，作者若为自己的工具链导出过
   `APPLE_ID`，每次构建都会不请自来地连 Apple。

### 2.3 公证只有环境变量这一个接口

`MacTargetHelper.getNotarizeOptions` 从 `process.env` 组装参数，**不读配置对象**。所以
`withNotarizationEnv` 是唯一的通路（与既有的 `withSigntoolPath` 同形）。它额外**清空
另外两条 Apple 凭据路线**：`getNotarizeOptions` 先查 `APPLE_ID`，作者环境里有那组变量
就会赢下优先级，用 Studio 从未拿到的身份去公证。

## 3. 各平台在 Mac 宿主上的现状

| 目标 | 结论 | 依据 |
| --- | --- | --- |
| Windows（PFX） | **可签**。app-builder-lib 26.15.6 非 Windows 宿主走 `computeOsslsigncodeArgs` | 读源码 + 真实 app 里选中 PFX 后只报联网警告，无 host-unsupported |
| Windows（证书存储） | 拒绝，报 `signing-host-unsupported` | 真实 app 实证 |
| Windows（Azure） | 不受宿主限制（远端签名） | 既有逻辑未改 |
| macOS | 本轮新增 | 见 §4 |
| Android | **可签**，纯 TS 的 v2 签名器与宿主无关 | 既有实现 + 类型/测试 |
| iOS | **可签**。`zsign-macos-arm64` 上游有资产，vendoring 表里早已有 darwin/arm64 行 | 本机跑 `prepare-codesign-tools.js` 落地并 `zsign -v` 成功 |
| GPG | 需修（见下） | — |

### 3.1 gpg 发现器在 macOS 上够不着（本轮修复）

`findGpg` 在非 Windows 分支上**只查 PATH**。macOS 上从 Finder 双击启动的 app 不继承
登录 shell 环境——launchd 给的 PATH 是 `/usr/bin:/bin:/usr/sbin:/sbin`，而 Homebrew、
MacPorts、GPG Suite 装的 gpg 全在这之外。于是同一台机器、同一个二进制，从终端起
Studio 找得到，双击图标起就找不到。

与 Windows 那条 "Git for Windows 的 gpg 对 PATH 不可见" 是同一类问题，修法也照抄：
PATH 之后再查 `MACOS_GPG_DIRS`（Homebrew ARM → Homebrew Intel → MacPorts → GPG Suite）。

## 4. macOS 身份探测：`-v` 会藏起"装了但用不了"的证书

`security find-identity -v -p codesigning` 是 UI 该提供的列表——**它正是
electron-builder 自己搜索的那个列表**（`getValidIdentities` 用同一条命令），所以
Studio 提供的与它会找到的一定一致。

但 `-v` 会滤掉过期的、缺私钥的、签发链不完整的证书。把这些报成"本机没有这张证书"
会让作者去找一份他其实已经有的文件。所以 preflight **只在准备报错时**再问一次
不带 `-v` 的宽列表，据此在两个码之间选择：

- `signing-macos-identity-missing` — 真的不在
- `signing-macos-identity-unusable` — 在，但过期／缺私钥／链不全（最常见是导入时漏了
  Apple 中间证书）

另有 `signing-macos-not-developer-id`（warning）：选了 `Apple Development` 一类证书时，
构建会成功、产物在本机能跑，但别人的 Mac 上会被 Gatekeeper 拒绝，Apple 也不会公证它。

## 5. 验收记录（2026-07-31，本机 macOS 14.8.7 / arm64）

本机**没有任何有效的代码签名身份**（`security find-identity -v` 返回 0 条），也没有
Apple 开发者证书。因此下面明确区分"实证"与"未能实证"。

### 5.1 实证通过

| 项 | 判官 | 结论 |
| --- | --- | --- |
| zsign 落地并可执行 | `zsign -v` | `version: 1.1.1`，arm64 Mach-O，无 quarantine |
| 身份解析器对真实 `security` 输出 | 真跑 `security find-identity`（含一个自签证书的 throwaway 钥匙串） | 13 个测试全绿，含"宽列表 ⊇ 窄列表"关系 |
| electron-builder 选项名 | `app-builder-lib/scheme.json`（`additionalProperties: false`） | `identity` / `notarize` / `cscLink` / `cscKeyPassword` 四个键都在 MacConfiguration 里 |
| 凭据导入 → 证书检视 | 真实 app 的 IPC；自写 PKCS#12 读取器读出的 SHA-1 与 `security find-identity` 报的**逐位一致**（互为独立 oracle） | `D5EAC3C9…9673` |
| 保险库落盘 | 直接看文件 | index 0600、material 目录 0700、.p8 与 .p12 均 0600；口令经 safeStorage 封装（`v10` 前缀），全树 grep 不到明文 |
| 半填公证被拒 | 真实 app | 报 `needs all of notaryKeyFile, notaryKeyId, notaryIssuerId; missing …` |
| Windows PFX 在 Mac 上被接受 | 真实 app | 只报 `signing-needs-network`，无 host-unsupported |
| Windows 证书存储在 Mac 上被拒 | 真实 app | 报 `signing-host-unsupported` |
| 钥匙串身份不存在时报错 | 真实 app | 报 `signing-macos-identity-missing`，文案带证书名 |
| 五行签名 UI | 真实 app | Windows / macOS / Detached / Android / iOS 全部渲染，各自文案正确 |
| **`identity: null` 真的不签** | 真跑 electron-builder 出 .app | 日志 `skipped macOS code signing reason=identity explicitly is set to null`，产物标识符仍是 `Electron` |
| **签名 + fuse 翻转不互相破坏** | 同上，带真实游戏 fuse 集 | `executing @electron/fuses` → `signing` 顺序成立，产物标识符被改写成 appId |

后两条由 `src/main/buildWorker/macSigningOracle.test.ts` 固定下来（`NLS_MAC_SIGN_ORACLE=1` 启用，
默认跳过，每次约 1 分钟）。用 ad-hoc 身份（`identity: "-"`）替代真实 Developer ID：它走的是
**完全相同的路径**（findSigningIdentity → buildSignOptions → @electron/osx-sign → codesign），
只差最后进 CMS 的是哪张证书。

**两条容易踩空的事实**：

- **arm64 macOS 上不存在"没有签名"这个状态**。Apple 要求每个二进制至少带 ad-hoc 签名才能执行，
  所以 Electron 的 dist 本身就是 ad-hoc 签过的，未签名构建出来依然 `Signature=adhoc`。
  区分"我们签了"和"我们没签"的是**标识符**：签名步骤会把它改写成 appId，跳过时保留 dist 自带的
  `Electron`。拿"有没有签名"当断言会永远为真。
- **fuse 翻转必须在签名之前**，否则 `resetAdHocDarwinSignature` 会把真签名换成 ad-hoc 的。
  app-builder-lib 自己写了注释 `the fuses MUST be flipped right before signing`（`platformPackager.js:258`），
  顺序是对的——但这是本轮 `hasSigningIdentityForPlatform` 给 macOS 打开
  `enableEmbeddedAsarIntegrityValidation` 之后才开始有意义的一条依赖，所以钉住它。

### 5.2 **未能实证**（如实记录，不要在交接里当成已验证）

- **用一张真实的 Developer ID 证书签出产物**，以及由此才谈得上的 `spctl --assess` /
  Gatekeeper 接受。已验证的是**签名步骤本身会跑、会改写标识符、且不被 fuse 翻转破坏**
  （§5.1 末两行，用 ad-hoc 身份），未验证的是"换成真证书后 CMS 里那张证书是对的、且系统认它"。
  自签证书要被 `security find-identity -v` 收录就必须加进用户的信任存储，那是修改机器的
  安全设置，本轮没有做。`signing-macos-identity-unusable` 分支因此只由**捕获的真实
  `security` 输出**驱动的单元测试覆盖，未走过完整构建。
- **公证**。要 Apple 开发者账号与联网提交，本机没有。
- **iOS 真机安装**（沿用上一轮的边界）。
- **GPG 分离签名在 Mac 上的端到端**。本机没有 gpg（`MACOS_GPG_DIRS` 四个位置都没有），
  发现器的 macOS 分支由合成目录树的测试覆盖。

## 6. 跑真实应用才暴露、测试全绿也没抓到的两个缺陷

与上一轮同样的教训，再次成立。

1. **`onPersistSigning` 手写了四个平台名**（`BuildDialog.tsx`），加第五个平台编译完全
   干净，然后在写盘的路上把 macOS 的凭据 id 丢掉：UI 上作者的选择在、工程文件里没有、
   而 preflight 是从工程文件读回的，于是它继续说这份构建"未签名"。改成整体传入，
   由 `updateSigningConfiguration` 里那个以 `SIGNING_PLATFORMS` 为键的 normalizer 负责
   过滤——那张表加平台时必须给答案。
   **教训通用**：**手写字段列表是"新增一项时静默丢弃"的经典形状**，仓库里已经有
   `Record<SigningPlatform, true>` 这个惯例专治此病，但调用点绕过了它。
2. **preflight 文案里漏译平台 id**："This machine runs **macos**"。渲染层只把 `platform`
   一个字段过了 `build.platform.*`，而 `host`、`targetPlatform`、`platforms`（逗号连接的
   列表）装的是同一套 id。这条在 Windows 那轮就存在，但 macOS 宿主会频繁命中它。
   改成一张 `PLATFORM_DETAIL_FIELDS` 表统一处理，并**显式列出字段而非按值猜**——
   "linux" 是平台 id，也可能是别的东西的子串。

## 7. 遗留

- 上一轮就有的 `docs/plans/2026-07-26-027`（文件对话框测试通道）仍是 `status: ready`
  未实现，所以本轮 UI 验收里凡是要选文件的步骤都只能绕过原生对话框、直接调 IPC。
  导入表单的**文件选择按钮本身**因此未走过真实点击。
- 签名后的 macOS 产物是否真的通过 `spctl --assess`、公证是否真的成功，等一张真实的
  Developer ID 证书到位后必须补测；在那之前 UI 不应向作者承诺"可分发"。

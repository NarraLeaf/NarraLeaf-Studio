---
title: "plan: Live2D / Spine 2D 接入姿态与法务约束勘验"
type: plan
status: draft
date: 2026-07-27
---

# plan: Live2D / Spine 2D 接入姿态与法务约束勘验

> 本文只回答"以什么姿态接入"与"有没有法律条款要求"。不含实现排期。
> 条款引用来自各家官方 EULA 页面（见 §7）。**在做出任何商务承诺前，必须由人再逐字复核一遍原文**——
> 本文的条款编号来自对官方页面的自动摘录，语义可靠但不能当作法律意见。

---

## 0. 结论先行

| | Live2D Cubism | Spine 2D |
|---|---|---|
| 能否把 SDK/runtime 放进 Studio 仓库并随 Studio 分发 | **不能** | **能**（但建议不要，见 §6.2） |
| 与 Studio/引擎的 MPL-2.0 是否冲突 | **正面冲突**（"excluded license"条款） | 不冲突，但 runtime 本身非开源，不能当 MPL 的 Covered Software |
| NarraLeaf 自己需要买什么 | 不需要买（前提是不分发 SDK） | **必须持有一份 Spine Editor 授权**（Trial 不算） |
| Studio 用户需要什么 | 自己去 live2d.com 下 SDK 并接受两份协议；年销 < 1000 万日元豁免发布许可 | **每个用 Spine 功能的用户各自需要一份 Spine Editor 授权** |
| 最大的雷 | "Expandable Application"——免费产品原则上不批 | Trial 授权明确不含 runtime 集成权 |
| 建议 | 走「用户自备 SDK」，仿 Ren'Py / TyranoScript | 可先行；条款明确点名了我们这种工具 |

**统一姿态：Studio 与引擎只提供接缝，不提供 SDK。** 两条线都成立，但成立的理由不同——
Live2D 是**被迫**（不许分发），Spine 是**选择**（许可但用户仍需自证授权）。

**建议 Spine 先行、Live2D 后做**：Spine 的条款把我们这种"game toolkit"逐字写进去了，边界清楚；
Live2D 的 Expandable Application 定义模糊且对免费产品不友好，值得先去信确认再动工。

---

## 1. 法务勘验 —— Live2D Cubism

Cubism SDK 由两份协议共同覆盖：**Live2D Open Software License**（Framework、Samples，源码可读）
与 **Live2D Proprietary Software License**（Cubism Core，闭源二进制 / `live2dcubismcore.min.js`）。
下载 SDK 时必须同时同意两份。

### 1.1 "excluded license" 条款 —— 与 MPL-2.0 正面冲突

两份协议都有同一条：

- Open Software License **§5.7**：
  "The Source Code may not be altered or Distributed in such way as the excluded license applies to part of the Software."
- Proprietary License **§5.3.2** 对 Redistributable Code 有等价约束。

"excluded license" 的定义是满足以下任一条的许可：
**(i) 其代码以源码形式发布或分发；或 (ii) 第三方可以修改其代码。**

**MPL-2.0 两条全中**（§3.2 要求提供 Source Code Form，§2.1 授予修改权）。而：

- `narraleaf-react` 是 **MPL-2.0**，且以带源码的形式发布到 npm；
- `NarraLeaf-Studio` 是 **MPL-2.0**，且仓库公开在 GitHub。

→ **任何 Cubism 代码（Framework 源码或 Core）进这两个仓库都构成违约。** 这条是硬的，不是风险偏好问题。

（严格说 MPL 是文件级 copyleft，理论上可以让 Live2D 文件保留自己的 header 不受 MPL 覆盖。
但见 §1.2——即使绕开 §5.7，公开仓库这条路依然堵死。）

### 1.2 Framework 源码不能进公开仓库

Open Software License：

- **§2.1** 授予 "non-exclusive right to use, copy, show, demonstrate and alter"，但**禁止再许可或转让给第三方**；
- **§2.2** 分发只在四种情形下允许：嵌入 Derivative Work 并搭配 Live2D 指定的 runtime（§2.2.1）、
  分发给持有同版本权利的其他被许可人（§2.2.2）、分发给**承继本协议**的第三方（§2.2.3）、
  约 30 行以内的代码片段（§2.2.4）。

公开 GitHub 仓库面向的是**从未接受过该协议的所有人**，不落在任何一条里。

### 1.3 Core 是 Redistributable Code，但只能"嵌进成品"

- **§5.1**：Customer 可以复制分发 Redistributable Code；
- **§5.2** 条件：Derivative Work 必须在 Redistributable Code 之上**加上使用它的主要功能**，
  且原样分发不得修改，且要让下游同意等价保护条款；
- **§6.2**：除 Redistributable Code 外，**不得分发或披露本 Software，也不得与 Derivative Work 一起打包**。

→ Core 可以随**做好的游戏**一起出货（这是作者的权利），但**不能作为"给开发者用的库"分发**。
Studio 把 Core 打进安装包 = 后者。

**实证（2026-07-27，`CubismSdkForWeb-5-r.5/Core/RedistributableFiles.txt` 原文）**，
可再分发文件**只有三个**：

```
- live2dcubismcore.d.ts
- live2dcubismcore.js
- live2dcubismcore.min.js
```

即：**Framework 不在可再分发清单上**。Framework 归 Open Software License 管，只能按 §2.2 的四种情形分发
（见 §1.2），而那四种都不包含"放进公开仓库"。这把 §1.1 与 §1.2 的结论钉死了——
Core 尚有"嵌进成品"这条路，Framework 连这条路都没有。

### 1.4 "Expandable Application" —— 最大的雷

Live2D 的定义：

> "any work having significant expandability among services or content utilizing SDK products.
> It includes Derivative Works which use and generate any indefinite numbers of models by adding
> or combining files or data (e.g. avatar)..."

官方 FAQ 明说：

> "The SDK Release License (Publication License Agreement) does not apply to works that include
> Expandable Applications such as avatar systems."

即：**Expandable Application 不吃"个人/小规模事业者豁免"，不论规模一律要单独审批 + 签特别发布许可**，
条件包括**收入分成、销售报告、在应用内显示 Expandable Application logo、上官方 Showcase**，
而且——

> "Existence of a valid revenue model (as a general rule, fully free of charge is not eligible for approval)."

**Studio 是免费的。** 如果 NarraLeaf 自己捆绑 Core 并把 Studio 作为"能载入任意 Live2D 模型的应用"发布，
就正面撞进这个定义，且原则上不予批准。

**反过来，如果 Studio 不分发 SDK：** Derivative Work 的发布者是**作者**而不是 NarraLeaf。
作者做的是一个模型集有限且固定的 VN，不是 Expandable Application，年销 < 1000 万日元豁免发布许可。
**这正是 Ren'Py / TyranoScript 的姿态之所以成立的原因，也是我们唯一可走的路。**

### 1.5 编辑器内预览是安全的

FAQ 列出的免签情形包含 "use of Live2D Cubism SDK during the SDK trial and development stage"。
作者用**自己装的** Core 在 Studio 里预览属于开发阶段，不构成发布。

---

## 2. 法务勘验 —— Spine 2D（Esoteric Software）

Spine Runtimes 的分发条件写在 **Spine Editor License Agreement §2**，Runtimes License 只是引用它。

### 2.1 集成：允许，但有两个前置

**§2.1**：

> "You may integrate the Spine Runtimes into software or otherwise create derivative works of the
> Spine Runtimes (collectively, 'Products'), provided that: (a) each Product adds significant and
> primary functionality to the Spine Runtimes; and (b) You have a valid Spine Editor license at the
> time the Spine Runtimes are integrated into each Product."

- (a) Studio 显然满足（它是个 IDE，不是 runtime 的薄壳）。
- (b) **NarraLeaf 必须在集成时持有有效的 Spine Editor 授权。**

**§1.4.1** 堵死了省钱的路：

> "The Spine Trial license does not grant rights to integrate, distribute, or otherwise make use of
> the Spine Runtimes. Section 2 does not apply to the Spine Trial license."

价格（官方页面，2026-07 查）：Essential **$69**、Professional **$379**、
Enterprise **$2,499 + $379/人/年**（年收入 ≥ $500,000 USD 强制 Enterprise，收入口径含投资与融资）。
→ 以 NarraLeaf 目前的形态，**一份 Essential $69 即可满足 §2.1(b)**。

### 2.2 分发：允许，但必须附协议

**§2.2**：

> "...provided that: (a) the Spine Runtimes License Agreement provided in Exhibit A is included in
> the documentation or other materials provided with each Product; and (b) You had a valid Spine
> Editor license at the time the Spine Runtimes were integrated into each Product."

→ Studio 的第三方声明里必须包含 Spine Runtimes License 全文与版权声明。

### 2.3 §2.4 —— 条款逐字点名了我们这种工具

> "For example, consider an SDK, game toolkit, or software library used to create new applications
> that contain the Spine Runtimes. **Each user of such an SDK, game toolkit, or software library must
> obtain a Spine Editor license** because the applications they are creating contain the Spine
> Runtimes, so are therefore a Product, and a Spine Editor license is required to create or modify a Product."

→ 这是**已被明文承认的合法形态**。代价是：**每个用 Studio 的 Spine 功能导出游戏的作者，各自要有一份
Spine Editor 授权**。Studio 有义务把这件事讲清楚。

### 2.4 授权到期不影响已出货产品

按 Esoteric 的现行许可说明：授权只在**集成的那一刻**需要有效；之后产品可继续分发。
对作者友好，也意味着 NarraLeaf 买一次 Essential 即可覆盖当次集成。

### 2.5 与 MPL-2.0 的关系

Spine 没有 Live2D 那种 "excluded license" 条款，所以**不冲突**。但 Spine Runtimes License
**不是开源许可**（npm 上 `@esotericsoftware/spine-webgl@4.3.13` 的 license 字段是 `LicenseRef-LICENSE`），
所以不能把 runtime 源码 vendor 进仓库当作 MPL 的 Covered Software。
**以 npm 依赖形式引用是干净的**——Esoteric 自己就把 runtime 发布在 npm 上
（`@esotericsoftware/spine-webgl`、`@esotericsoftware/spine-pixi-v8`，均 4.3.13）。

---

## 3. 第三条法务线：作者的模型资产本身

两家的**编辑器授权**与**SDK/runtime 授权**是两回事：

- Live2D 模型若由 Cubism Editor 制作，作者需要相应的 Editor 授权等级（商用有门槛）；
- Spine 导出的 `.skel` / `.json` / `.atlas` 同理。

这不是 Studio 的法律责任，但**是 Studio 的产品责任**：导入这两类资产时应给出一次性提示。

---

## 4. 先例勘验（免费 VN 引擎怎么做的）

| 项目 | Live2D | Spine |
|---|---|---|
| **Ren'Py** | 不捆绑。用户自己下 `CubismSdkForNative-5-r.1.zip`，放进 SDK 目录，在 launcher 的 "Install libraries" 里安装。文档写明"你的公司年收入超过一定额度可能需要购买授权" | — |
| **TyranoScript** | 不捆绑。引擎与插件免费，用户自己去 Live2D 官网下 **Cubism Core for Web**。文档同时列出 Proprietary License 与 SDK Release License 两道 | — |
| **WebGAL** | — | **把 `pixi-spine` 从仓库里移除**，用户自己 `yarn add` 并取消 `spine.ts` 里的注释；文档写明"每个使用 Spine 功能的用户必须持有有效的 Spine Editor 授权"，并附免责声明 |
| **pixi-live2d-display** | 不捆绑 Core，README 要求用户自备 `live2dcubismcore.min.js` | — |

**没有任何一个免费引擎捆绑 Cubism Core。** 这不是巧合，是 §1.3 + §1.4 的必然结果。

---

## 5. 技术接缝勘验（接进来要动哪儿）

### 5.1 引擎侧：Live2D/Spine 是**第三种 Displayable**，引擎必须开口

`narraleaf-react` 的舞台元素模型是 `Displayable` 抽象基类 + 两个具体子类：

- `dist/game/nlcore/elements/displayable/image.d.ts`
- `dist/game/nlcore/elements/displayable/text.d.ts`

没有第三种，也没有任何"自定义 displayable"扩展点。
→ **这是跨仓库的活**：渲染必须落在引擎里（引擎拥有舞台、变换、层、过渡、camera），
Studio 只能提供作者面与编译。

### 5.2 Studio 侧：`CharacterAppearance` 已经是判别联合，模式现成

`src/renderer/lib/workspace/services/character/types.ts:134-143`：

```ts
export interface PresetAppearance { kind: "preset"; ... }
export interface LayeredAppearance { kind: "layered"; ... }
```

且注释已确立"kind 切换是 cold switch，丢弃另一 kind 的数据（user ruling 2026-07-26）"。
加 `kind: "live2d"` / `kind: "spine"` 是**沿着既有形状**加，不是新架构。
同步要动的还有 `src/shared/types/devMode.ts:99` 的 `CharacterAppearanceSummary`。

### 5.3 资产管线：这是**多文件资产**，是新形状

现有资产模型是单文件（一张 PNG = 一个 assetId）。而：

- Live2D 一个模型 = `.model3.json` + `.moc3` + 贴图组 + `.motion3.json` × N + `.physics3.json` + `.cdi3.json`
- Spine 一个模型 = `.skel`/`.json` + `.atlas` + 贴图页 × N

需要一个"资产族/资产包"概念（导入时整目录收编、重命名时整族跟随、加密打包时整族进 artifact）。
**这是本次接入里最大的一块工程量，比渲染还大。**

### 5.4 插件路线今天走不通

按 `docs/plans/2026-07-26-017-plan-runtime-plugin-api.md` §1 的硬约束：

- 插件**不能在舞台上画任何东西**——只能注册"作者摆放的 widget"；
- importmap 是 5 项白名单（runtime + 4 个 React），**不新增宿主模块**；
- CSP `script-src 'self' nlgame:`，无 `unsafe-eval`；
- `react-dom/client` 刻意不给游戏环境，插件不得自建 React root；
- 新 API 实现必须落在 `src/renderer/lib/ui-editor/` 下。

→ 想让"Live2D 插件"成立，得先把 M-RUNTIME 的 `app.game.ui` 从"overlay"扩成**舞台图层扩展点**。
这是一个独立的前置里程碑，不是本卡能顺手做的。

---

## 6. 推荐姿态

### 6.1 三层结构：引擎开口 / 后端旁挂 / 用户自备 SDK

```
L1  narraleaf-react (MPL-2.0)
    └─ 新增抽象 displayable：只定义接口（加载 / 播放 / 设参数 / 接入 transform·layer·transition）
       ★ 零 Live2D / Spine 代码。引擎的 MPL 保持干净。
       ★ backend 由宿主在启动时注入。

L2  后端适配器（独立包，非 MPL）
    ├─ @narraleaf/spine-backend   → 依赖 @esotericsoftware/spine-webgl，随包附 Spine Runtimes License
    └─ @narraleaf/live2d-backend  → ★ 只含胶水代码。Core 在运行时从用户提供的路径加载，永不入库。

L3  NarraLeaf-Studio (MPL-2.0)
    ├─ CharacterAppearance 加 kind: "live2d" | "spine"
    ├─ 资产族模型（§5.3）
    ├─ Dev Mode 预览 / 导出时把 backend + 用户的 SDK 一起打进 build
    └─ SDK 获取与授权门控 UI（见 6.3）
```

### 6.2 Spine：捆不捆绑是个裁决项

条款允许捆绑（§2.1 + §2.2 都满足即可，负担落在导出游戏的作者身上）。但建议**不默认捆绑**：

- 与 WebGAL 的做法一致，减少"用户装了 Studio 就等于持有了 Spine runtime"的观感；
- 减少安装包体积；
- 让"我确认我持有 Spine Editor 授权"这道门变得有意义。

实现上用 `optionalDependencies` + 功能门控，而不是像 WebGAL 那样让用户改源码。

### 6.3 Live2D：仿 Ren'Py 做一个"安装 SDK"入口

- Studio 里给一个入口：告诉用户去 `live2d.com` 下 **Cubism SDK for Web** 的 zip
  （下载页本身就是他们接受两份协议的地方），把 zip 拖进 Studio；
- Studio 解出 `Core/live2dcubismcore.min.js`，落到项目或用户目录；
- **Studio 绝不代为下载。** 代下载 = 分发 = 回到 §1.3 的禁区。

### 6.4 门控与告知

| 时机 | 内容 |
|---|---|
| 首次启用 Spine 功能 | 要求用户确认持有 Spine Editor 授权（Trial 不算）；链接到 Esoteric 购买页 |
| 首次启用 Live2D 功能 | 展示两份协议要点 + 1000 万日元年销阈值 + Expandable Application 提示；链接到 Live2D 官网 |
| 导出/打包时 | 若工程用到 Spine，在产物的第三方声明里注入 Spine Runtimes License 全文 |
| 关于页 / 第三方声明 | 两家的版权声明常驻 |

---

## 7. 待裁决

1. **是否购买 Spine Editor Essential（$69）** —— 这是 §2.1(b) 的硬前提，不买则整条 Spine 线不能动工。
2. **Spine runtime 捆绑还是 opt-in**（§6.2 建议 opt-in）。
3. **是否主动去信 Live2D 确认姿态。** 倾向：**要。** Expandable Application 的边界模糊，
   "编辑器仅在开发阶段加载用户自备的 Core、不分发 SDK、不批量生成模型"这一姿态值得拿到书面确认，
   一次性永久消除风险。Live2D 有 Expandable Application 申请表单可作为接触入口。
4. **先做哪个** —— 建议 **Spine 先行**（条款明确、纯 WebGL、无模糊地带），Live2D 排在其后。
5. **走内置还是等 M-RUNTIME 开出舞台扩展点**（§5.4）。内置更快，扩展点更正确；
   若 Live2D 线因法务原因长期悬而未决，扩展点路线反而更划算——把"要不要装 Live2D"完全变成用户的选择。
6. **资产族模型的归属** —— 它不只服务 Live2D/Spine（分层立绘、语音包都想要），
   可能值得单独立卡先行。

---

## 8. 引用

- [Live2D Open Software License Agreement](https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html)
- [Live2D Proprietary Software License Agreement](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html)
- [Live2D SDK Release License (Publication License Agreement)](https://www.live2d.com/en/sdk/license/)
- [Live2D — A. Expandable Applications](https://www.live2d.com/en/sdk/license/expandable/)
- [Live2D Help — What is the SDK Release License?](https://help.live2d.com/en/sdk/sdk_001/)
- [Spine Editor License Agreement](https://en.esotericsoftware.com/spine-editor-license)
- [Spine Runtimes License Agreement](https://en.esotericsoftware.com/spine-runtimes-license)
- [Spine — Purchase](https://esotericsoftware.com/spine-purchase)
- [Ren'Py — Live2D Cubism](https://www.renpy.org/doc/html/live2d.html)
- [TyranoScript — Live2D プラグイン Ver4.x](https://tyranoscript.com/sample/live2d_4)
- [WebGAL — About Spine](https://docs.openwebgal.com/en/spine.html)
- [pixi-live2d-display](https://github.com/guansss/pixi-live2d-display)

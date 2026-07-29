---
title: "handoff: 版本控制五个里程碑已落地，交接渲染层与界面"
type: handoff
status: ready
date: 2026-07-28
plan: 2026-07-27-001-plan-editor-data-and-version-control.md
branch: feat/vcs-documents-and-repository
worktree: D:/Temp/nls-vcs
---

版本控制程序的**底座已经全部落地并合入 develop**（`87ddcc29`）：自有 Lore 绑定、规范化序列化
与文档模型、建库与工作集、三处显式顺序、文档模型在三个服务上的接入。

**渲染进程一行都还没写。** 你的任务从 V6a 开始，用户会另外给你界面思路。

先读 [计划](2026-07-27-001-plan-editor-data-and-version-control.md)（里程碑、三条产品裁决）与
[docs/version-control.md](../version-control.md)（唯一技术事实源，**§4 的 20 个坑全部实测**）。
本文只讲交接：现状、能用什么、以及**会决定你界面设计的四条硬约束**。

---

## 一、已落地（都已合入 develop 并推送）

| 里程碑 | 内容 | 证据 |
|---|---|---|
| **V0** | 自有 koffi 绑定取代 `@lore-vcs/sdk` 运行时；22 个 verb；ABI 快照机器校验 | 178 测试，25 个打真 DLL |
| **H1** | `src/shared/documents/`：规范化 JSON、`DocumentSpec` 注册表、损坏隔离 | 113 测试，含 2 万例模糊测试 |
| **V1** | 建库 / 工作集（`.loreignore`）/ 状态；`VcsManager.initRepository`、`getStatus` | 226 测试，47 个打真库 |
| **H2a** | 故事 / 蓝图 / 资产三处显式顺序（story v11→12、bp v9→10、资产独立顺序文件） | 全量 2917 通过 |
| **H2b 第一波** | 存储适配器（双进程）+ 四个 spec + variables/voice/localization 接入 | 全量 2966 通过 |

全量测试：**2966 通过**，失败仍是那 **5 个 win32 基线文件 / 8 个测试**
（`GameBuildManager`、`mobileSigningIdentity`、`storageManager`、`runtimeProtocol`、`path`
——文件权限位与路径分隔符，与本程序无关）。五个 tsconfig 项目全部干净。

## 二、还没做

| | |
|---|---|
| **H2b 第二波** | 其余 6 个服务接入文档模型。**前置是 `undefined` 审计**，见计划 §3.3.2 的清单 |
| **H2c** | 全项目规范化（normalize-on-open）。**必须等所有服务接入之后** |
| **V2** | 提交与检查点（含 `versionControl.checkpointIntervalMinutes` 设置） |
| **V6a** | 渲染层框架：`VersionControlService` + IPC + 类型。**你从这里开始** |
| **V3 / V4 / V5** | 语义 diff / 恢复 / 协作 |

## 三、会决定你界面设计的四条硬约束

### 1. 状态查询**不能挂定时器轮询**（§4.17）

`repositoryStatus(scan)` **不是纯读**。扫描发现一个**新目录**会把它记进暂存状态；之后目录被删掉，
接下来整个 session 都把它报成删除——尽管它从未提交过。对照实验（同样的文件操作、同样的最终磁盘
状态，只差中间一次扫描）：

```
不调用中间扫描 -> []
调用了中间扫描 -> ["fresh:2", "fresh/inner.txt:2"]     // 2 = DELETE
```

所以「侧边栏实时显示变更数」这种最自然的设计不能用轮询实现。作者中途建个临时目录又删掉，两次
轮询之间就会在他的变更列表里留下不存在的删除项；他若照着提交，提交的是幽灵。**按需扫描**，
并且 V2 的定时检查点也不能靠「定时扫一遍看有没有变化」来判断该不该提交。

### 2. 改过内容的文件报 `action: KEEP(0)`（§4.18）

`LoreFileAction` 没有 MODIFY 成员。把 `action` 读成「没变」会让**项目里每一处编辑从变更列表里
消失**。映射已经在 `repository.ts` 的 `CHANGE_KINDS` 里做好了，别绕过它自己读原始 action。

### 3. 首次 diff 可能要联网，但单机项目完全不涉及

Lore 的工作副本是稀疏的。封装层已开 `cache: true` / `localCache: true`，但远端项目第一次读历史
仍可能走网络。**要有 loading 态**，不要假装是本地即时操作。

### 4. VCS 是**可选能力**，先问 `getAvailability()`

Intel Mac 与 Windows ARM64 没有官方原生构建。**不可用时整个入口不该存在**，不要放一个点了报错的
按钮。三种不可用各有 `reason`，对用户要说不同的话（`unsupported-platform` = 你的机器不支持；
`backend-missing` / `backend-load-failed` = 你的安装坏了）。

判定是缓存的，但**不再是永久的**——`refreshVcsAvailability()` 现在真的能用（旧 SDK 时代它是个
谎，因为模块求值失败被 Node 永久缓存）。

## 四、你能用的东西

### 主进程已就绪（`VcsManager`，按项目路径 keying）

| 方法 | |
|---|---|
| `getAvailability()` | **先问这个** |
| `initRepository(projectPath, options)` | 建库 + 写忽略文件 + 首次提交 + flush，**事务性**（中途失败会回滚 `.lore/`） |
| `getStatus(projectPath)` | 分支、修订、逐文件变更、汇总计数、同步状态 |
| `isRepository` / `getInfo` / `getHistory` / `readBlob` / `getChangedPaths` / `getThreeWay` / `getMergeBase` | 只读面，2026-07-18 就有 |

### IPC 只有旧的 8 个只读 handler

`initRepository` 与 `getStatus` **还没有 IPC**，这是 V6a 的活。故意停在 `VcsManager`：在 UI 定型
之前放出接口，等于让渲染层绑定一个还会变的形状。

### 文档模型（`src/shared/documents/`）

diff 界面要的东西在这里：`resolveDocumentSpecForPath` 把仓库路径反查成 spec，`spec.parse` 把
blob 变成文档，`spec.summarize` 给标题与计数。`DocumentSpec.diff` **还没实现**（V3）。

## 五、验收方式（用户的硬要求）

- **UI 验收必须你亲眼看**。子代理的报告、测试全绿都不算数。
- 起实例：`tools/ui-verify/scenarios/iso-tree.sh <branch> <isoDir>`，然后 junction node_modules，
  然后带 **`--disable-features=CalculateNativeWinOcclusion`** 启动。**绝不许抢前台/置顶**——
  加了那个开关，窗口埋在别人的编辑器后面也照样 `hidden=false`。
- 重跑 `iso-tree.sh` 到同一个目录前，**先 `cmd /c rmdir <ISO>\node_modules` 摘掉 junction**：
  脚本开头是 `rm -rf`，撞上指向真 node_modules 的 junction 会报 busy（本轮踩过，侥幸没递归删掉）。
- 端口：本轮用 CDP **9224** + `NLS_DEV_RELOAD_PORT=5599`。别用默认 9222/5588——那是别人的 session。

**这一轮真 app 验收抓到的东西，测试一个都没抓到**：

1. 资产顺序文件用了 `writeFileNoFollow`（无条件 lstat，只能覆盖已存在的文件），于是**每个现存
   工程首次打开都七个 ENOENT 弹窗 + 永久 Save failed**。22 个测试全绿，因为它们跑在内存夹具上，
   而「写 API 拒绝不存在的文件」在那种夹具里**不可表达**。
2. 第一次测损坏隔离时，第二次 `launch` 复用了同一个窗口、服务早已初始化，**损坏文件根本没被读**
   ——「文件没变」当时是个假绿。必须整个重启才是真的读一次。

## 六、这轮顺带修掉的既有 bug（与版本控制无关）

- **变量面板一直按倒序列场景变量。** `createDeclaration` 插在场景**顶部**
  （`beforeBlockId: rootBlockIds[0]`），`insertBlockInScene` 追加到记录**末尾**，而面板读的是记录。
  错误顺序还跨存读被保留。
- 蓝图「默认打开哪张图」与资产浏览器顺序，都只差一次规范化就会变成 UUID 排序的产物。

## 七、环境

| | |
|---|---|
| 工作 worktree | `D:/Temp/nls-vcs`（分支 `feat/vcs-documents-and-repository`，已并入 develop，树干净） |
| 验证树 | 本轮用完已清理；按 §5 重建 |
| 项目副本 | `D:/Temp/nls-vcs-proj`（已还原为 pristine，来源 `D:/Temp/nls-u4-proj-pristine`） |
| 主 checkout | **有别的 session 的 37 个未提交文件**，别动，也别在那儿切分支 |
| 依赖形态变了 | `koffi` 成了直接依赖、`@lore-vcs/sdk` 降为 devDependency、四个平台包进 optionalDependencies。node_modules 里东西都在，但**新 clone / CI 需要 `yarn install`** |

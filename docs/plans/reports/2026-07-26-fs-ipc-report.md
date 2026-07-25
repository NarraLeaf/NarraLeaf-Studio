# 主进程 fs IPC 收敛 报告（NarraLeaf-Studio）

分支 `feat/fs-ipc-consolidation`（从 develop `1aecb95`＝`15466bb+` 切），2 commit，未合并未 push。

## 状态
WI-1 加性 fileName + 单一切分工厂: done · WI-2 删 Fs.listFiles: done · WI-3 递归求大小共用实现 + 新 IPC: done · WI-4 插件类型包重生成 + 版本号: done（未 publish）。零打包行为改动。

## 停机条款核查（都未触发）
- **directorySize 与新 IPC 已共用一份实现**：`Fs.directorySize`（`@shared/utils/fs`）是唯一的求大小函数。`GameBuildManager` 读它的 `.totalBytes`（删掉了自己那份私有递归 + `Dirent` import）；新 `fs.directorySize` IPC 直接返回它；总览页读该 IPC。**没有第二份遍历可以分家。**
- **`Fs.listFiles` 零消费者**：`fs.d.ts`/`fileEntry.ts` 注释里的引用是文档，非调用。已删。
- **插件包重生成未动 build 脚本结构**：`yarn build:plugin-types` 原样跑通并 verify（含两 surface 跨 entry 兼容检查）。

## 关键设计 / 文件
- `fileEntry.ts`: 新 `splitFileEntry(fileName)→{name,ext,fileName}`，是 `entryFileName` 的逆。`FsListHandler`（fsAction.ts）与 `privilegedAction.ts` 的 list 分支**都经它构造条目**——两份重复切分收成一份。仅 import `@shared/utils/path`（不碰 fs）。
- `fs.ts`: 新 `FileEntry = FileStat & {fileName}`（加性，`name`/`ext` 语义一字未改）；新 `DirectorySizeResult{totalBytes,fileCount,bytesByRelativePath}` 与 `Fs.directorySize`——递归、`Dirent` 分类（符号链接算 0 且不进）、不可读目录=空、不可读文件=0、相对键恒用 `/`。
- 类型链 `FileStat[]→FileEntry[]`：ipcEvents / privileged / renderer / privilegedFacade / services / FileSystem。新 IPC 走**内部 base bridge**（`getInterface().fs.directorySize`），**不进插件 privileged 面**（内部能力，非过度扩面）。
- `assetOverviewSnapshot.ts`: 删逐文件 `fs.list`+`fs.details` 遍历（`walkDirectoryBytes`/`mapWithLimit` 移除），改单次 `fs.directorySize`。抽出纯函数 `assetBytesFromWalk` 承接原 bug 所在的归属逻辑。页面语义不变；**符号链接口径随构建统一**（原走 fs.stat 会跟随，现算 0）。
- WI-4: `packages/plugin-types` 0.2.0→**0.3.0**（对齐"加性 API=minor"惯例，上一次 0.1.0→0.2.0 同理）。`dist/` 是 gitignore 的构建产物、未提交；重生成后 `_api.d.ts` 里 `fs.list` 返回 `FileEntry[]`（含 `fileName`）已确认。README 未文档化 fs.list，无需改。

## entryFileName 既有消费者：不改（取舍）
`nlproj.ts`（`name==="project"&&ext===".json"` 探测，正是 `name` 不能重定义的原因）与 `importPathExpansion.ts` 保持 `entryFileName`。它们已正确重组；改用 `.fileName` 会逼其内存树 fake 反过来生产 fileName——正是 M6 那次给 bug 背书的形状。WI 价值在"让下一个写错的人写不错"，不在重排现有正确代码。

## 验证
- **`yarn lint` 全绿**（5 个 tsc project exit 0）。
- **vitest 全量 2132 passed / 7 skipped / 新失败 0**（改造前基线 2113/0；本机 darwin 无 win32 基线）。新增单测：`splitFileEntry`↔`entryFileName` round-trip（多点名/dotfile/无扩展/结尾点/中文/含空格/大写——能击穿只取词干实现的那组）＋切分与旧 handler 逐字相等；`Fs.directorySize` 真临时目录的字节数/文件数/相对键、**build 与 IPC 同数**、缺目录=空、符号链接 0（无权限则跳过不制造假失败）；`assetBytesFromWalk` 归属（命中/缺文件=未知非 0/无本地路径跳过）。
- 插件类型包：`yarn build:plugin-types` 生成并 verify 通过；`FileEntry.fileName` 已入 `_api.d.ts`。

## 真机：未由我执行（诚实声明）
本机唯一在跑的 dev 实例来自**另一 agent 的 worktree**（`.claude/worktrees/story-editor-polish/...`，CDP 9222/9223），不含我的改动、且是他人活跃会话，不可扰动。干净隔离跑我这条分支需另起一次性 worktree+全量 build+一个带资产的 demo 工程（我手上没有），且 worktree 我无法按纪律清理——对一个已被确定性单测锁死（同数/符号链接/归属/round-trip）的后端管道改动不成比例。故真机留作用户手测验收：

**建议手测**：① 在有一定资产量的工程开资源总览——Total/各类型字节/TOP N/单资产 size 与侧栏及属性面板一致（除 assets/ 内手造符号链接场景，现随构建口径算 0）；② 首屏明显快于改造前（万级资产尤甚：单次 IPC vs 逐文件往返）；③ 打开装了插件的工程确认插件仍正常加载（类型包重生成不影响运行时，确认一次）。

## 共享检出纪律
全程逐文件 `git add`，无 `-A`/`.`、无 `stash`、无 `worktree remove`；每次 commit 前 `git branch --show-current`。期间检出被并行 agent 切到过 `feat/story-a4-slash-subjects`/`feat/stage-preload-fast-start`（三分支彼时同处 `1aecb95`，切回零风险），我的改动始终完整。`package.json` 及 story-editor/i18n/storyStageSnapshot 等脏文件属他人 WIP，未碰未提交。

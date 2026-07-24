# M4 引擎批 报告（narraleaf-react 仓）
分支/commits: `feat/studio-m4-batch` @ 7ee4a5a..69d46be（4 commits），在**隔离 git worktree** `D:\Dev\org\NarraLeaf\narraleaf-react-m4` 上工作。

## 状态
WI-1 all/any/allAsync 硬化: done · WI-2 fastForward({actionId}): done · WI-3 播放头/调用栈只读 API: done · WI-5 换行: 核实**已原生支持**（无需改动） · WI-4 text-event token: **设计完成，实现顺延**（§偏离）。WI-1..3（底线）全达成。

## 起手协调（重要）
- 侦察发现引擎仓**共享检出有并发会话正在实时写入**（Camera 特性：camera.ts/Camera.tsx/SceneDialogs.tsx… mtimes 秒级递增，16:14→16:21 连续 batch）。故未在共享树提交/切分支，改用独立 worktree（node_modules junction），零打扰并发会话。
- "默认分支"辨析：git 默认 `master` 落后 `dev_nomen` **60 commits**，且 WI-2 扩展的 `feat(save): fast-forward to next menu`（`until:"menu"`）只在 dev_nomen。故基线取 **dev_nomen**（非 master，否则 WI-2/3 无从扩展）。
- 用户授权后，把 dev_nomen 工作树里**已完成的** Control 修复（repeat/while unchained + do/doAsync 空体）作为首个 commit(e3eae58) 折入我的分支保存；未触碰并发会话的 Camera WIP。

## 文件 / API 签名摘要
- WI-1 `src/game/nlcore/action/controlParallel.test.ts`(新, 17测): StackModel+ControlAction 缝上系统化补测（无公开 API 变更）。
- WI-2 `game/liveGame.ts`, `action/stackModel.ts`, `game/fastForwardTarget.test.ts`(新, 11测):
  `fastForward(o?:{until?:"menu"|"end"|{actionId:string}; maxSteps?:number}): Promise<{reason:"menu"|"end"|"maxSteps"|"action"; reachedTarget?:boolean}>` — 到 actionId 即**执行前**停（reason"action"/reachedTarget:true）；菜单挡道/栈空/步上限=提前停+reachedTarget:false（区分"不可达/已越过"）；字符串模式保持裸 `{reason}` 向后兼容；仅扫根栈（并行/异步分支内 id 非停点，已注）。
  `StackModel.peekTopActionId(): string|null`（非抛顶层 action id 探针）。
- WI-3 `game/liveGame.ts`, `action/stackModel.ts`, `game/introspection.test.ts`(新, 8测)，均 @experimental 只读：
  `LiveGame.onCurrentActionChange(fc):Token` + `getCurrentActionId():string|null` + 事件 `event:action.current` `{actionId,actionType}`（每 action 执行前发，含分支/异步 action，Studio 按 actionIdBindings 反查/过滤）。
  `LiveGame.getStackSnapshot():{root:StackSnapshot; async:StackSnapshot[]}`；`StackModel.snapshot():StackSnapshot`（顶优先、跳 awaitable、含嵌套并行分支+loop 配置）；新类型 `StackFrameSnapshot`/`StackSnapshot`。

## WI-1 发现（缺陷清单）
- 折入的既有修复（非本轮新发现，dev_nomen 工作树已修，此处保存+补测）: ①`Control.repeat`/`whileLoop` 多语句体曾被 authoring 链化→运行时 checkActionChain 抛 "Invalid action chain"，改 `pushUnchained`；②`Control.do([])`/`doAsync([])` 空体曾产生悬挂 child / LiveGame 收集时解引用 null，已守空。补测覆盖二者。
- 新观察（**非缺陷，已文档化不改**）: `Control.any` 一旦某分支先 settle 即继续，**其余分支不被中止、后台跑完副作用**（`Awaitable.any` 仅在 fail/skip 时中止 losers）。与文档"resolving once any finishes"一致（≈Promise.race 语义）。若 Studio 演出透镜需要"胜出即掐断其余"，属语义决策→需产品确认后再改（停机报告条款）。
- 无架构级缺陷。三扰动（skip/save-load/undo）在 StackModel 缝均有正确实现，已补 17 测锁定：all/any 完成语义、并行组中途 serialize/deserialize 往返（含非对称一支已排空）、abortStackTop 递归中止在途分支（含嵌套/已 settle 不动）。

## 偏离与决策
- WI-4 顺延（§卡准许裁剪）: 最大块，需改渲染层打字机（roll/trySkip）且引擎仓**无 React 无头测试设施**（Sentence.tsx 无测）→ 未实现以免上不可验证的渲染改动。**设计结论：无架构根本冲突**（见下），交下轮实现。
- WI-5 = 已原生支持，无代码改动: `\n` 在 word 串内 → `Sentence.tsx` textUpdater yield `"\n"`(38)、渲染 `<br>`(549)、skip 路径处理(391)、容器 `whitespace-pre-wrap`(581)；type/skip/preview 三路皆过。Studio 行模型不变（换行只在富文本 run 内）。
- WI-4 设计（先设计后实现，已交付设计）: token 类比 Pause 入 word 串；渲染缝=打字机 roll() 揭示到 token 时执行受限副作用（Image.char/SE），trySkip(untilEnd) 对已越过 token **落最终态**；**零新增存档负担/重放安全**成立——Sentence 词不入存档（`Sentence.toData()`→null、metadata "not serialized"），效果随 say 动作重评重放；存档只带常规 elementStates。推荐首版：token 携效果描述符，渲染层直改元素态+flush（不入 stackModel，故不产生 save 项）。

## 验证
- 引擎自有测试全绿: `vitest run` 227 通过（基线 191 + 新增 36：WI-1×17 / WI-2×11 / WI-3×8），0 失败。
- lint: eslint 改动文件全绿（exit 0，仅 eslint-plugin-react 版本 warning，非本改动）。`tsc`（build:dev 内）全过，签名变更类型自洽。
- 跨仓联调: 每 WI 后 `build:dev` + `postbuild --target-dir` 拷 dist 入 Studio `node_modules/narraleaf-react`；Studio 编译器集成 `vitest src/renderer/lib/ui-editor/runtime/game` 每轮 **102 通过 / 0 失败**（末轮为 WI-3 dist）。

## 风险与已知
- 行尾: 仓 `core.autocrlf=true` 但既有 blob 存 CRLF、新文件存 LF（仓既有漂移）。本机 autocrlf=true 检出即 CRLF→lint 净；若 orchestrator 环境 autocrlf≠true，我的新文件需 renormalize。未加仓级 `.gitattributes`（避免全仓 renormalize scope creep）。
- WI-3 API 标 @experimental：不承诺内部结构稳定；`event:action.current` 对每 action 发（含分支），Studio 需按自有 id 集过滤。
- `Control.any` losers 不掐断（见 WI-1 观察）；WI-4 待实现；worktree 未删（`git worktree remove` 待并入后清理）。

## 重点验收（真机，Studio 侧后续里程碑消费）
1. fastForward({actionId}) 驱 Dev Mode 时间线热跳：命中行前停、越过/不可达返回 reachedTarget:false。
2. onCurrentActionChange/getStackSnapshot 驱播放头+调用栈视图（并行组分支可视）。
3. WI-4 实现落地时按上设计验 skip=落最终态 + 存/读/撤重放一致。

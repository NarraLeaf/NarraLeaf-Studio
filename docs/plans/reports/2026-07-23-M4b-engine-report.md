# M4b 引擎批二 报告（narraleaf-react 仓）
分支/commits: `feat/studio-m4b-text-event` @ `27eb425`(dev_nomen 基线)..`33a5c23`（2 commits），在隔离 worktree `D:\Dev\org\NarraLeaf\narraleaf-react-m4`。

## 状态
WI-0 三 nit: done（`76f63b2`） · WI-1 text-event token: done，五条契约全达（`33a5c23`）。无停机、无公开 API 破坏。

## WI-0 复核 nits
1. **peek 误报**：新增 `StackModel.peekExecutingActionId(): string|null`（**只看栈顶项**，仅当它是裸 CalledActionResult 才回其 id；栈顶是挂起 awaitable → null）。`fastForward` 的 actionId 命中改用它，故"进行中 do 块的续延"不再被 `peekTopActionId`（跳 awaitable）提前命中。测试：真 StackModel 直测（action+awaitable 压栈 → 新探针 null / 旧探针仍见埋藏 id）+ 两相 fastForward 集成（复核代理指的"scripted 模型表达不了的栈形"，用 phase 标志锁"先 settle 再命中"）。
2. **公共导出**：`StackSnapshot`/`StackFrameSnapshot` 从 `@core/common/game` barrel 导出（Studio 不必再 ReturnType 取型）。
3. **零监听零分配**：`event:action.current` 的 payload 仅在 `events.hasListeners(...)` 为真时构造；`_currentActionId`（拉取式 `getCurrentActionId`）照常更新。补测锁"无订阅者时不 emit 但 id 仍更"。

## WI-1 text-event token — 最终 API
- 核心令牌 `TextEvent`（`@core/elements/character/textEvent`，入公共 barrel）：
  - `TextEvent.expression(image: Image, appearance: ImageSrc|Color|string[], options?: {sound?: Sound}): TextEvent`
  - `TextEvent.sound(sound: Sound): TextEvent` · `new TextEvent(config: TextEventConfig)` · `TextEvent.isTextEvent(o): o is TextEvent`
  - 导出型 `TextEventAppearance` / `TextEventExpression` / `TextEventConfig`（受限闭集：表情切换 + 可选 SE，无任意动作）。
- `Image.prototype._setAppearanceSync(appearance)`（@internal）：镜像 `char()` 的解析（src/Color 直改；tag 走 `resolveTags`），只改 `state.currentSrc`，**无 transition/无 actionHistory/无 stackModel**。
- 派发（@internal，`@player/elements/say/textEventEffect`）：`dispatchTextEvent(event, state)` 直改元素态 + 重绘（layered→flush，否则→updateStyleSync）+ SE `audioManager.play` fire-and-forget；`fireTextEventOnce(event, fired: Set<TextEvent>, state)` 幂等门。
- 词流一致性：`TextEvent` 与 `Pause` 并列进 `Word.text` 联合类型；`Word.evaluate/getText/isTextEvent`、`Sentence.isSingleWord/StaticWord/formatStaticWord/evaluate` 平行处理；打字机 `Sentence.tsx` 的 `textUpdater` 产出令牌，`roll()` 揭示即派发、`trySkip(untilEnd)` 与非 typeEffect 即时揭示对所有越过令牌落终态，`firedEvents` 幂等；预览路径不触发副作用。

## 五条契约
①入 word 串类比 Pause ✓ ②揭示即副作用不入 stackModel ✓ ③skip=落终态（trySkip/即时揭示越过令牌全派发）✓ ④重放安全/零存档负担：`Sentence.toData()→null` 不变，效果搭常规 elementStates 序列化、随 say 重评重放 ✓ ⑤同令牌每次 roll 至多触发一次 ✓。

## 测试与验证
- 引擎全量 `vitest run` **257 通过 / 0 失败**（基线 235 + WI-0×5 + WI-1×17）。缝级为主：令牌构造/词流存活/`toData→null`、`_setAppearanceSync`（tag+src）、存读档态一致、派发（表情/SE）、幂等、skip 越过全派发。
- lint（eslint，CRLF）改动文件全绿；`tsc --noEmit` 全过（联合类型加宽已扩至 say/menu/nvl/gameState 各 `words` 槽）。
- 跨仓：每 WI 后 `build:dev` + postbuild `--target-dir` 拷 Studio dist；Studio `vitest src/renderer/lib/ui-editor/runtime/game` 两轮 **102/102**。

## 真机验证（引擎无 React 无头设施；用 raw NLR story 手测）
```ts
const alice = new Image({ src: { groups: [["normal","angry"]], defaults: ["normal"],
  resolve: (e:string) => `/alice-${e}.png` } });
scene.action([ alice.show(),
  hero.say(["别", TextEvent.expression(alice, ["angry"]), "惹我。"]) ]);
```
核验：打字揭示到令牌位 → alice 立刻切 angry；中途点击 skip → 落 angry 终态；说话中途存档→读档 → angry 一致。

## Studio 侧未来编译器接口建议（**仅接口，不实现**）
`buildSentenceParts`（storyCompiler.ts:1335）现按 rich run 产 `Pause`/`Word`。新增一类 run `{ textEvent: { characterId/objectName, appearance: string[]|src, sound?: SoundRef } }`，编译为
`TextEvent.expression(getImage(ctx, name, ...), appearance, { sound })` 推入 prompt 数组即可（表情图元用既有 `getImage`/`resolveCharacterImageUrl` 解析）。行内表情 UI 卡消费此接口。

## 已知/风险
- 非 typeEffect 即时揭示的 SE 在 React 严格模式双挂载下可能双响（表情幂等无碍）；typeEffect 主路径有 `firedEvents` 守护。
- WI-1 首版不带 transition（令牌即时换态，符"直改元素态"）；transition/相对多组表情等留后续。
- worktree 未删（并入 dev_nomen 后再 `git worktree remove`）。

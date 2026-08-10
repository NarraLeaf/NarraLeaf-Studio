# 工程级配色方案（Brand）

Card 2026-08-09-001 · 分支 `feat/project-brand-palette` · worktree `.claude/worktrees/brand`（无 junction）

作者在 Project ▸ Brand 里维护一份工程自己的配色；颜色选择器可以把一个值**填成对这份配色的链接**，
而不是一个死掉的十六进制。改配色，所有链接跟着变——编辑器画布、Dev Mode 预览、打包后的游戏都变。

用户已裁决的三条（2026-08-09）：

- 预设 = **四个语义色**（primary / secondary / background / foreground）**外加按控件分组的控件色**，
  分组用手风琴展开；**新建控件自动套用**；首版一律回溯到 Studio 主色 `#40A8C4`。
- **蓝图颜色字面量、工程图标背景色都不接**（Studio 设置里的强调色本来就不接——那是 Studio 偏好，不是工程数据）。
- 删除被引用的颜色：**照删，先数出引用数警告**；断链解析到兜底色，由 lint 报出来。

## §1 存哪里：`editor/brand.json`，不是 `.nlproj`

`.nlproj` 是 **msgpack 二进制**（`shared/utils/nlproj.ts:47`）。配色是作者天天动、且需要在版本控制里
逐条看见「谁把 primary 改了」的内容，塞进二进制配置等于让每次改色都变成一个不可读的整文件 diff。

所以走**已注册文档**这条既有路：`editor/brand.json` + 一个 `brandSpec`，和
`editor/audio-tracks.json` 完全同构（`shared/documents/specs/audioTracks.ts` 的注释把这个理由已经写过一遍）。
白拿到的东西：VCS 语义 diff、三方合并、`DebouncedSaver` 自动保存、`unreadable` 闩锁（读不出来时拒绝写回，
避免把「读不出」变成「没有了」）、以及历史/撤销通道。

**服务照抄 `AudioTrackService`**：`listColors()` / `onColorsChanged()` / `createColor` / `renameColor` /
`updateColor` / `deleteColor` / `getRevision()`，seed 在首次读取时补齐、丢了会重新补齐。

## §2 模型：一个数组，一套 id 空间

控件色不另开一张表——它们就是 id 带点号的预设项，面板按前缀分组显示。一套 id、一条解析路径。

```ts
type BrandColor = {
    id: string;      // 稳定。链接按它存，改名不会断链
    name?: string;   // 作者起的名字；预设项缺省时显示 i18n 默认名
    value: string;   // CSS 字面量，或另一条 nlbrand: 链接（见下）
    builtin?: true;  // 由 id 是否在 seed 表里派生，从不采信文件里写的
};

type ProjectBrandDocument = { schemaVersion: 1; colors: BrandColor[] };
```

**一层间接是允许的**：一个 brand 项的 `value` 可以是指向另一个 brand 项的链接。这正是
「控件色跟着主色走」的实现方式，也是「改 primary，按钮跟着变」这句需求的字面意思。
解析器带 visited 集合 + 深度上限，成环返回兜底色；写入端在面板里就不给出会成环的选项。

作者新增的颜色只进扁平语义区，**不能往控件分组里加槽位**——槽位是控件消费端定死的。

### seed 表（id 一旦发布永久固定）

| id | 默认值 | 落到哪 |
|---|---|---|
| `primary` | `#40A8C4` | — |
| `secondary` | `#2E6E80` | primary 暗一档 |
| `background` | `#101317` | — |
| `foreground` | `#F2F4F7` | — |
| `button.primary` | → `primary` | `backgroundColor` |
| `button.secondary` | → `secondary` | 悬停/按下填充（见 §7 甲乙两类） |
| `button.border` | → `secondary` | `borderColor` |
| `button.text` | → `foreground` | `color` |
| `button.shadow` | `rgba(0,0,0,0.35)` | `effects.effectShadow.color`（见 §7） |
| `container.background` | → `background` | `backgroundColor` |
| `container.border` | → `secondary` | `borderColor` |
| `container.shadow` | `rgba(0,0,0,0.35)` | 同上 |
| `text.primary` | → `foreground` | `color` |
| `text.muted` | `#9AA3AE` | 作者手动引用 |
| `textInput.background` | → `background` | `backgroundColor` |
| `textInput.border` | → `secondary` | `borderColor` |
| `textInput.text` | → `foreground` | `color` |

v1 只发 button / container / text / textInput 四组——作者摆得最多的四个。switch / slider / list /
image / video / puppet 的槽位留到后续，加一组的成本就是往 seed 表加几行 + 一条 i18n。

## §3 链接协议

```
nlbrand:<id>            → 该颜色，alpha = 1
nlbrand:<id>/<alpha>    → 该颜色，alpha ∈ [0,1]
```

`<id>` 是 `[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)?`（预设）或生成的短 id（作者新增的，所以改名永不断链）。

**为什么这个形状是安全的**：现有的三个解析器全都会拒绝它，不存在被误当成颜色的可能——
`normalizeHex` 不是十六进制、`RGBA_REGEX` 不匹配、`normalizeOpaqueBackgroundColor` 的
「裸颜色名」分支要求 `^[a-z]+$`（有冒号就出局）。也就是说：接入前后，**没接入的地方拿到链接
只会走到它原本的兜底分支，不会画出一个错误的颜色**——这是分批接入的安全网。

## §4 解析接缝：那对已经存在的 colorUtils

`build-runtime.js:69` 已经把 `@/apps/.../framework/utils/colorUtils` 别名到
`src/runtime/renderer/shims/colorUtils.ts`。编辑器一份、游戏一份，**接缝天然就在这里**，不用新造。

两份都加：

- `isBrandColorLink(raw)`
- `parseColorValue(raw, fallback)` → 返回值增加 `link?: string`；链接经注册表解析出 hex
- `colorValueToCss(value)` → **签名不变，永远吐能上屏的 CSS**，链接在这里被解开
- `serializeColorValue(value)` → **新增**，吐存盘形态（有 link 就吐 `nlbrand:…`，否则就是今天的行为）
- `setBrandPalette(entries)` / 注册表 + 环检测

**接入一处 = 读的那侧不用动（`parseColorValue` 已经处理），写的那侧把 `colorValueToCss` 换成
`serializeColorValue`。** 就这一句。

注册表怎么被喂：

| 宿主 | 喂它的人 |
|---|---|
| 编辑器 | `BrandService` → `framework/fields/brandPalette.ts`（照抄 `recentColors.ts` 那 33 行） |
| 打包游戏 / 预览 | `GameRuntimeApp` 拿到 pack 时推一次（照抄 `sidecarBackend.applyPack(pack)`） |

**画布重绘**：brand 改动不是文档改动，画布不会自己重画。`BrandService` 维护一个 revision，
画布宿主用 `useSyncExternalStore` 读它并作为 prop 往下传——`SurfaceElementTreeContent` 的 memo
比的是**全部 props**，多一个变化的 prop 就足以让它失效。编辑器画布从不设 `staticDocument`
（见 memory `devmode-surface-switch-cost`），所以这一条只影响作者真的在改配色的那一刻。

## §5 颜色选择器

```ts
interface ColorPickerTriggerProps {
    // ...既有
    /** 显示工程配色圆点行。默认关，每个调用点显式打开 */
    brandPalette?: boolean;
    /** 不允许选的 id（Brand 页面自己用：排除自身与会成环的项） */
    brandExclude?: string[];
}
```

`ColorValue` 增加 `link?: string`。面板底部加一行圆点：

- 圆点复用 `ProjectPalette.tsx` 里 `Swatch` 的形状（`h-5 w-5 rounded-md`，用户数据的裸 hex
  是设计规范 §0 明确豁免的）；hover 出名字用**原生 `title=`** ——面板本身是 `overflow-y:auto`，
  共享的 CSS `Tooltip` 在这种容器里会被裁（设计规范 §7 自己标注了这个限制）。
- 当前值是链接时，对应圆点带选中环。
- 在色域图 / hex / RGB 里改任何一笔 → **清掉链接**，回到字面量。
- alpha 滑块在链接之上照常可用，序列化成 `nlbrand:<id>/<alpha>`。

顺手改名：`framework/fields/ProjectPalette.tsx` 只有富文本工具栏一个调用点，而它现在跟本功能的
词汇正面冲突（它是「快捷色板」，不是工程配色）。改名 `SwatchPalette`，一个 import 的事。

## §6 接入清单

**接（约 20 处）**——全部是 UI 编辑器控件外观 + 场景背景 + 人物强调色：

`shared/appearance/compact/{CompactBackgroundAppearance, CompactTextAppearance, BorderStrokeCompactRows}` ·
`shared/appearance/editors/{containerValueEditor, buttonValueEditor}`（各 2 处）·
`shared/chrome/rectangleLikeInspector`（2 处）· `shared/effects/EffectsStackEditor` ·
`builtin/{button, textInput}/inspector` · `builtin/{video, puppet, list}/inspector` 的声明式
`colorPicker` 字段（各 2 处）· `properties/schemas/sceneSchema.ts` 的 `scene.backgroundColor` ·
`properties/fields/CharacterColorField` · `characters/dialogs/CreateCharacterDialogContent` ·
框架层 `ColorPickerField` / `ColorPickerGroupField`（透传 prop，字段定义上加 `brandPalette?: boolean`）

**不接（8 处，各有各的理由）**：

- 剧情侧全部 —— `StoryLineValueToken`、`StorySceneActionInspector` 的两处（正文着色 / 背景色）、
  `RichTextToolbar`。剧情是 NLR 驱动的静态脚本树，改内容会牵动后续哈希校验（用户裁决）。
- `settings/components/SettingColorPicker` —— Studio 自己的偏好，跟工程无关。
- `blueprint-lite/BlueprintColorValueControl` —— 存的是 `{r,g,b,a}` 对象，接入要动
  blueprint 值类型的 schema（用户裁决：不接）。
- `project/sections/ProjectIconsSection` —— 图标烘焙在主进程/构建期（用户裁决：不接）。

## §7 新建控件自动套用：甲乙两类，只有甲类能真的自动

`createDefaultElement()` 里已经把每个默认值物化进新元素的 props（`button.tsx:29`
`...defaultButtonWidgetProps`）。所以把其中的颜色项换成链接字符串即可，**`defaultXWidgetProps`
这个「读取兜底」保持字面量不动**——否则从没设过颜色的**存量**控件也会跟着变色，那是静默改变
已有工程的外观。

- **甲类：新建时就有值的槽位**（`backgroundColor` / `borderColor` / `color`）→ v1 直接写成链接，
  新按钮立刻是品牌色。
- **乙类：新建时压根没有那一行的槽位** —— `button.secondary` 对应的是**悬停态**，而
  `createInitialButtonAppearance` 只建一个 `default` 变体、不建条件行；`*.shadow` 对应
  `effects.effectShadow`，默认是 `null`。

  乙类要「自动套用」，就得让**新建按钮从此带一条 hover 行和一层阴影**——那是在改「一个全新按钮是什么」，
  不只是改它的颜色。**建议 v1 不做**：槽位照发、在外观编辑器的选择器里可选，作者加了 hover 行/阴影
  就能引用它。这一条需要你点头（见 §11）。

## §8 运行时通道

1. `DevModeBundle` 加 `brand?: BrandColorTable`（照 `localization` / `voice` / `audio` 的先例）。
2. `bundleAssembler.ts` 读 `editor/brand.json`，和 `loadAutoSaveConfiguration` 并排一行。
3. **`DevModeManager.watchProjectFiles` 必须把这个路径加进 chokidar 列表**
   （`DevModeManager.ts:466` 现在只盯 uidoc / uigraphs / story / localization / character / 资产）。
   不加，运行中的预览**永远不会**因为改配色而重载。
   顺带记一笔：`editor/variables.json` 与 `editor/audio-tracks.json` 今天就有同样的缺口，本轮不修。
4. `GameRuntimePackV1` 无需新字段（brand 在 `pack.bundle` 里）。
5. **`resolveGameRuntimeInitialBackgroundColor(pack)` 要会解析链接**
   （`shared/utils/gameRuntimeEntrySurface.ts:24`）。它在**首帧之前**决定 BrowserWindow 底色，
   也被 web 导出烘进 index.html。入口 surface 的背景色一旦是链接，这里会解析失败、
   静默回落 `#000000` —— 表现就是浅色游戏启动时闪一下黑。pack 里有 brand，它够得着。

## §9 删除与断链

- 删除前数引用：照 `countAudioTrackReferences` 的写法扫 uidoc + 人物档 + 场景设置，
  确认框里写清「有 N 处在用」，然后照删。
- 断链解析到兜底色（`#FF00FF` 一类刺眼色不合规范；用 `foreground` 的当前值，并由 lint 说明）。
- 新增一条 lint 规则「颜色链接指向不存在的配色」。加规则要动五处，见 memory `project-lint-system`。

## §10 里程碑

| | 内容 | 产出 |
|---|---|---|
| M1 | 文档 spec + `BrandService` + seed + Brand 子页（增删改、手风琴分组、freeze guard、help 主题） | 面板能用，还没人消费 |
| M2 | 链接协议 + 两份 colorUtils + 注册表/环检测 + 选择器圆点行 + 画布 revision | 编辑器里链接生效 |
| M3 | bundle 字段 + assembler + watcher + 窗口底色解析 | Dev Mode 与打包游戏生效 |
| M4 | 接入 §6 那 20 处 + 新建控件默认（甲类） | 功能完整 |
| M5 | 引用计数 + lint 规则 + 测试 + `docs/` 更新 | 收尾 |

验收：`node <shared>/node_modules/typescript/bin/tsc --noEmit` 五个 project + vitest
（含 i18n parity，改 catalog 必跑）+ `node scripts/style-ratchet.mjs`；真机一轮
——改 brand 的 primary，肉眼确认画布上的按钮、运行中的 Dev Mode 两边都跟着变。

## §11 待你点头的两件

1. **§7 乙类**：新建按钮要不要从此自带一条 hover 行 + 一层阴影，好让 `secondary` / `shadow`
   两个槽位真的「自动套用」？（建议：v1 不带，槽位照发。）
2. **Brand 在侧栏的位置**：现有五行的顺序是「离玩家由近到远」。配色是玩家最先看见的东西，
   建议插在 `game` 之后 → app / game / **brand** / project / runtimes / settings。

---
title: "plan: Surface 开关控件 nl.switch"
type: plan
status: active
date: 2026-08-07
---

# plan: Surface 开关控件 `nl.switch`

> 界面编辑器今天有滑块（`nl.slider`）、文本框（`nl.textInput`）和列表（`nl.list`），
> 唯独没有**布尔开关**。设置页里「全屏 / 跳过已读 / 自动前进」这类项，作者现在只能拿按钮
> 加一张私有蓝图自己拼，每做一个都要重写一遍状态与外观的对应关系。
>
> 本卡加一个控件 `nl.switch`，并配齐属于它的整套蓝图节点与派生节点。

---

## 0. 为什么这张卡比看起来小

勘验结论：**开关需要的机械全部已经在 develop 上了**，一件新原语都不用发明。
这张卡的工程量集中在「把已有机械按开关的语义接一遍」，加上一处小的类型扩展（§7）。

| 需要的东西 | 现状 |
|---|---|
| 控件扩展点（类型 / 图标 / 默认元素 / 默认子元素 / 检查器 / docker） | 已有，`widget-modules/types.ts:201`，`createDefaultChildElements` 就是滑块建 track+handle 用的那个 |
| 「内部组件可自定义」的槽机制 | 已有，`extra.sliderSlot` / `extra.listSlot` 的同款做法，配套的树保护也已成型（§3 清单第 8–12 项） |
| 状态外观（开 / 关两套长相） | 已有，**外观变体 + `runtimeVariantOverrideId`**，见 §2 |
| 状态过渡动画（滑块滑过去、颜色渐变） | 已有，`AppearanceFieldTransition` 逐字段过渡 + `RectangleChromeRenderer` 的 `motion.div`，见 §2 |
| 「作者值 vs 玩家值」两层 | 已有，`WidgetRuntimeStateStore` 的 slider/textInput 两条先例 |
| 私有蓝图（控件自己的事件图） | 已有，`logicApi.supportsPrivateBlueprint` 一开就生成 |
| self / element 两套节点的模板 | 已有，`sliderNodes.ts` 与 `textInputNodes.ts` 是同一套写法的两个副本 |
| 通用 Get/Set Visible·Enabled 节点 | 已有，`widgetPropertyNodes.ts` 的 `WIDGET_TARGETS` 一行生成 8 个 |
| boolean 字面量节点与 boolean 值图 | 已有，`BLUEPRINT_NODE_TYPE_LITERAL_BOOLEAN`，`LocalBlueprintService.createValueGraphIr` **已经认 `"boolean"`**（condition 图在用） |

**真正新写的只有三块**：控件模块本身（§2）、`switchNodes.ts` 那 10 个节点（§5）、
以及把 `"boolean"` 接进元素值绑定（§7，可以推迟到 M3）。

---

## 1. 裁决

**D1. 开关是「按钮族」不是「滑块族」，但内部结构照滑块。**
事件面按 `nl.button` 给全套 `DISPLAYABLE_EVENTS`（hover / focus / 右键都在），
因为设置页的开关就是个会被鼠标碰的控件；而 track + thumb 两个子槽、
`createDefaultChildElements` 建默认子元素、检查器里的「部件」卡片，全部照 `nl.slider` 抄。

**D2. 开 / 关的长相走外观变体，不走新机制。**
两个子元素各带两个变体：`default`（关）与固定 id **`on`**（开）。
渲染器只做一件事——`checked` 为真时给两个子元素写 `extra.runtimeVariantOverrideId = "on"`。
这条路径列表的每行变体已经在走（写侧 `BindingEvaluator.ts:31`，读侧 `EditorNodeWrapper.tsx:155`、
`container/renderer.tsx:298`）。
→ 作者用**现成的外观编辑器**改开态长相，不新增任何检查器面板。

**D3. 滑块的行程也是外观，不是布局覆盖。**
thumb 的位移写在 `on` 变体的 **`transformOffsetX`** 上，不像 `nl.slider` 那样在渲染器里
算 `elementOverrides` 改 `layout.x`。理由有三条：

1. `transformOffsetX` 在 `CONTAINER_ANIMATABLE_KEYS` 里（`appearanceMotion.ts:58`），
   于是**过渡动画白拿**——作者在既有的「运动」编辑器里设 180ms easeOut，
   `RectangleChromeRenderer` 把它交给 `motion.div`（`RectangleChromeRenderer.tsx:126,131`）。
   走 `layout.x` 覆盖则一帧跳过去，要动画就得另写一套。
2. 渲染器因此**一行几何计算都不用有**。滑块那 100 行
   （`findRenderedUiElement` / `rectAxisStart` / `layoutWithSliderValue`…）在开关这里全部不存在。
3. 作者可以顺手让 thumb 在切换时同时变色、缩放、旋转——同一个变体里再加几个字段而已。

**代价（要如实写进文档）**：行程是一个**存下来的数字**，作者把 track 改宽之后它不会自己跟。
补偿是检查器「部件」卡片上的一个「按当前尺寸重算行程」动作（和滑块的「修复部件」同款位置）。
不做自动重算——那会把作者故意设的短行程悄悄改掉。

**D4. 没有 orientation。**
滑块有横竖两向是因为音量条真的会竖着放；竖着的开关在视觉小说界面里不存在。
真要斜着摆，外观里有 `transformRotation`。**这条是刻意的克制，不是遗漏。**

**D5. 不接受用户子元素。**
和滑块一样：`uiElementTypeAcceptsChildren("nl.switch") === true`（它有结构子元素），
但 `uiElementTypeAcceptsUserChildren("nl.switch") === false`。
想要 "ON" / "OFF" 文字的作者，把开关和两个 `nl.text` 放进一个容器——那是容器的活。

**D6. `checked` 不进 `AppearanceSystemCondition`。**
那个联合（`hovered` / `active` / `disabled` / `focused`）是**系统伪状态**，
每个控件、每次外观解析都要过一遍。往里塞一个只有开关有的语义状态，
是让全仓所有控件为一个控件付钱，而 D2 的变体已经把这件事办了。

---

## 2. 控件本体

### 2.1 数据模型 `src/shared/types/ui-editor/switch.ts`

```ts
export type UISwitchChildSlot = "track" | "thumb";

export type UISwitchElementExtra = {
    switchSlot?: UISwitchChildSlot;
    runtimeVariantOverrideId?: string;
};

export type UISwitchWidgetProps = {
    /** The author's starting state. What the player toggles lives in WidgetRuntimeStateStore. */
    checked: boolean;
    /** Blocks pointer and keyboard toggling. Looks are the `disabled` appearance signal's job. */
    interactionDisabled: boolean;
    trackElementId?: string | null;
    thumbElementId?: string | null;
};

export type UISwitchRuntimeValue = { checked: boolean };
```

外加 `defaultSwitchWidgetProps` / `normalizeSwitchProps` / `resolveSwitchRuntimeValue` /
`getUISwitchChildSlot`，签名逐字照 `slider.ts`。

⚠ **属性表里没有 `transitionMs` / `transitionEasing` / `thumbInset`**。前两个是 `on` 变体
`transformOffsetX` 组上的 `transition`（D3），第三个是作者摆 thumb 摆出来的。
往这张表里加它们等于把同一个数字存两处——[[audio-bus-tree]] 那口井已经掉过三次。

### 2.2 默认子元素

`createDefaultChildElements` 建两个 `nl.container`，与滑块同构：

| 槽 | 默认几何（控件 52×28） | `default` 变体 | `on` 变体 |
|---|---|---|---|
| `track` | `0,0,52,28`，圆角 999 | 灰底 | 主色底（`backgroundColor` 带 transition） |
| `thumb` | `3,3,22,22`，圆角 999 | 白底 | `transformOffsetX = 24`（= 52 − 22 − 3×2），带 transition |

两个都用 `createInitialContainerAppearance(props)` 起手，然后**手工追加第二个变体**。

⚠ `createInitialContainerAppearance` 只会产出**一个**变体
（`initialAppearanceModel.ts:405`），`ensureContainerAppearanceHasAllKeys` 也只补缺失的
**键**、从不补缺失的**变体**。所以第二个变体必须由 `switch/helpers.ts` 自己造，
并且渲染器必须容忍它不存在（作者可以删）——`on` 解析不到时退回默认变体，
表现为「两个状态一个样」，不是崩。**这一条要有单测。**

### 2.3 渲染器 `builtin/switch/renderer.tsx`

职责被 D2/D3 压到很小：

1. 读作者 props + `runtimeStore.getSwitchProperties(runtimeElementKey)` 合成当前 `checked`（照滑块 `renderer.tsx:109-117`）。
2. `onPointerDown` / 键盘 Space·Enter → 写 `runtimeStore.setSwitchProperties(...)`，
   然后按序派发 `changed` → `turnedOn` 或 `turnedOff` → `flush`。
   `interactionDisabled` 或 `runtimeStore` 缺席时整条路径不接管指针。
3. `renderChildren({ childrenIds: [trackId, thumbId], instanceKey: \`switch-${element.id}\`,
   elementOverrides })`，`elementOverrides` 里**只**给两个子元素塞
   `extra.runtimeVariantOverrideId`，几何一个字节都不改。
4. track / thumb 任一缺失时画一个 fallback（照滑块的 `fallbackTrackStyle`），
   保证「作者删了部件」不是白屏。

事件派发要照滑块的 `valueChangedInFlightRef` 合并一次：连点会把图跑成串行队列。
开关不像滑块那样每帧产值，所以只需要「同一帧内多次点击折叠成一次」这一层，
不用 rAF 队列。

### 2.4 检查器 `builtin/switch/inspector.tsx`

`properties` 页两张 `CompactModuleCard`：

- **状态** —— `checked` 的 Blueprint Value 字段（`createBlueprintValueField`，`valueType: "boolean"`，
  见 §7；M3 之前先只放一个本地开关）+ 「禁用交互」勾选。
- **部件** —— 两个 `Button size="sm"` 选中 track / thumb（照滑块 `SliderPartsField`），
  缺件时出「修复部件」，齐全时出「按当前尺寸重算行程」（D3 的补偿）。

`interaction` 页放 `ReadonlyBlueprintSection`，与滑块一致。

⚠ 检查器里**不要**放逐字符提交的输入框。文本控件的 `renderLiteralEditor`
每敲一个字就 `updateElementProps`，而一次提交在真实工程上是 ~45ms（[[ui-editor-edit-path-cost]]）。
开关的属性全是布尔与按钮，天然没有这个问题——别顺手加个数字框把它请回来。

---

## 3. 接线清单（漏一处就是静默失效）

**A. 控件注册（六处，[[surface-widget-system]] 的老清单）**

1. `src/shared/types/ui-editor/switch.ts` —— §2.1。
2. `widget-modules/builtin/switch.tsx` + `switch/{renderer,inspector,helpers}.tsx`。
3. `widget-modules/builtin/index.ts` —— 加进 `BuiltinWidgetModules`。
4. **`runtime/builtin/index.ts`** —— 加进 `BuiltinElementRenderers`。
   漏了＝能插入、能选中、能改属性，**画布和打包游戏里都画不出东西**。
   `builtinRendererParity.test.ts` 双向守着这一条，会红。
5. `widget-modules/insertPalette.ts` —— `DEFAULT_INSERT_PALETTE_CONFIG` 加 `{ type: "nl.switch" }`。
   放 `primary`（和 `nl.textInput` 同级，它比视频/模型常用得多）。
   ⚠ `insertPalette.test.ts` 里有一份**硬编码的期望顺序**，同一次改。
6. `src/shared/i18n/catalog/{en,zh}/widgets.ts` —— `widgets.defaults.switch.{name,track,thumb}`、
   `widgets.switch.{title,state,parts,track,thumb,repairParts,recomputeTravel,interactionDisabled}`。

**B. 文档模型与编辑器交互（滑块每一处都有对应）**

7. `shared/types/ui-editor/widgetLogic.ts` —— `SWITCH_EVENTS` + `BUILTIN_WIDGET_LOGIC_APIS["nl.switch"]`（§4）。
8. `shared/types/ui-editor/document.ts:104` —— `UI_PARENT_CAPABLE_ELEMENT_TYPES` 加 `"nl.switch"`；
   `UI_USER_CHILD_PARENT_ELEMENT_TYPES` **不加**（D5）；
   `isUIElementFlowLayoutChild` 加一条 `parent.type === "nl.switch" && getUISwitchChildSlot(...)` 的豁免
   （`document.ts:208` 旁边）。
9. `workspace/services/ui-editor/UIDocumentService.ts:1322` —— 载入时按 `trackElementId` /
   `thumbElementId` 回填子元素的 `switchSlot`（滑块那段的孪生分支）。
10. 同文件 `:3205` —— 往开关里插子元素时默认 `switchSlot`。
11. `ui-editor/commands/uiEditorAlign.ts:88` —— 对齐操作排除槽子元素。
12. `ui-editor/interaction/containerDrillSelection.ts:120` —— 加进可下钻类型。
13. `ui-editor/runtime/surface/SurfaceElementTree.tsx:894` —— 子元素由控件自己渲染，树不渲染。

**C. 运行时值**

14. `runtime/appearance/WidgetRuntimeStateStore.ts` —— `switchProperties` map、
    `get/setSwitchProperties`、`WidgetRuntimeSnapshot` 字段、`STATIC_WIDGET_RUNTIME_SNAPSHOT` 字段。
15. `shared/types/blueprint/hostApi.ts` —— `widget.getSwitchProperties`（pure、可从绑定调）
    与 `widget.setSwitchProperties`（effectful、async）两条能力描述。
16. `blueprint-runtime/BlueprintHostApiBridge.ts` —— `BlueprintSwitchProperties` /
    `...Patch` 类型、`assertSwitchElement`、`readAuthoredSwitchProperties`、`readSwitchProperties`、
    `switchPropertiesEqual`、`hostApi.widget` 上的两个实现（照 slider 那两段，含 `scheduleElementFlush`）。

**D. 蓝图节点（§5）**

17. `shared/types/blueprint/graph.ts` —— 3 个事件头常量（加进 `:126` 那张事件头清单）+ 10 个节点类型常量。
18. `blueprint-nodes/built-in/switchNodes.ts` —— 新文件，10 个节点。
19. `blueprint-nodes/built-in/index.ts` —— import / export / 追加进 `allBuiltinBlueprintNodes`。
20. `blueprint-nodes/built-in/events/eventHeadNodes.ts` —— 3 个事件头 + 两个 boolean 引脚常量。
21. `blueprint-nodes/built-in/graphParamResolvers.ts` —— `resolveSwitchNodeOutput` 接进
    `resolveSelfOutput`；`WIDGET_PROPERTY_ELEMENT_TYPES` 加 `switch: "nl.switch"`。
22. `blueprint-nodes/built-in/widgetPropertyNodes.ts:61` —— `WIDGET_TARGETS` 加
    `{ key: "switch", elementType: "nl.switch", label: "Switch" }`（`supportsVariant` 不给：
    开关本体是个壳，变体在两个子元素上）。
23. `blueprint-nodes/built-in/elementNodes.ts:96` —— `DISPLAYABLE_WIDGET_TYPES` 加 `"nl.switch"`，
    让 Element Literal / Element Flush / 动画节点认它。
24. `apps/workspace/modules/blueprint-lite/blueprintNodeI18n.ts` + `catalog/{en,zh}/blueprint.ts` ——
    每个新标题 / 分类 / 引脚标签都要有键（§6）。

**E. 文档**

25. `docs/blueprint-node-plan.md` —— 在 `## Slider` 后面加 `## Switch` 一节，与既有条目同格式。

**不需要动的**（勘验确认，别照着别的控件顺手加）：
`referenceModel.ts` / `surfaceResourcePreload.ts` / `diagnostics/rules/resourceDiagnostics.ts`
——开关不引用任何资产；
`effects.ts` 的 `WIDGET_EFFECT_KINDS_BY_TYPE` ——不登记就回落容器那套，滑块也没登记；
`appearanceCapableWidgets.ts` ——开关本体不带外观模型，两个子元素是 `nl.container`，已经在名单里；
`uiDocumentContentRevisions.ts` 的签名投影 ——开关不会「把一个 surface 画到别处」。

---

## 4. 逻辑能力面 `widgetLogic.ts`

```ts
const SWITCH_EVENTS: readonly WidgetLogicEventDef[] = [
    INIT_EVENT,
    FLUSH_EVENT,
    ...SURFACE_LIFECYCLE_EVENTS,
    UNMOUNT_EVENT,
    { id: "changed",   displayName: "Changed",   dispatchKind: "interaction",
      headNodeTypes: ["blueprint.event.head.switchChanged"] },
    { id: "turnedOn",  displayName: "Turned on",  dispatchKind: "interaction",
      headNodeTypes: ["blueprint.event.head.switchTurnedOn"] },
    { id: "turnedOff", displayName: "Turned off", dispatchKind: "interaction",
      headNodeTypes: ["blueprint.event.head.switchTurnedOff"] },
    ...DISPLAYABLE_EVENTS,   // already contains the keyboard pair - do not add KEYBOARD_EVENTS again
    ...BROADCAST_EVENTS,
    ...WINDOW_EVENTS,
];
```

⚠ `DISPLAYABLE_EVENTS` 里已经含 `KEYBOARD_EVENTS`（`widgetLogic.ts:148`）。
再展开一次 `KEYBOARD_EVENTS` 会造出重复 id 的事件项——滑块和文本框是**不含**
`DISPLAYABLE_EVENTS` 才单列键盘的，别抄错那一半。

```ts
"nl.switch": {
    supportsPrivateBlueprint: true,
    blueprintLabel: "Switch logic",
    events: SWITCH_EVENTS,
    commands: [
        ...baseCommands,
        { id: "setChecked", displayName: "Set checked",
          capabilityId: "widget.setSwitchProperties", availability: "available" },
        { id: "toggle", displayName: "Toggle",
          capabilityId: "widget.setSwitchProperties", availability: "available" },
    ],
    readableState: [
        { id: "checked", displayName: "Checked" },
        { id: "visible", displayName: "Visible" },
        { id: "enabled", displayName: "Enabled" },
    ],
    writableProps: [
        { propPath: "checked", displayName: "Checked" },
        { propPath: "interactionDisabled", displayName: "Interaction disabled" },
    ],
},
```

---

## 5. 节点全集（21 个）

### 5.1 事件头 3 个（`eventHeadNodes.ts`）

| 类型 id | 标题 | 引脚 |
|---|---|---|
| `blueprint.event.head.switchChanged` | Changed | Then, **Checked**(bool), **Previous Checked**(bool) |
| `blueprint.event.head.switchTurnedOn` | Turned On | Then |
| `blueprint.event.head.switchTurnedOff` | Turned Off | Then |

⚠ 文件里现成的 `PIN_VALUE` / `PIN_PREVIOUS_VALUE` 是 **float**（`eventHeadNodes.ts:164`，
上面那行注释就在说这件事），文本框已经为此另开了一对 string 引脚。
开关同理要另开一对 boolean 的，**不要复用**。

`turnedOn` / `turnedOff` 是 `changed` 的糖：三条都在同一次切换里派发，顺序是
`changed` → `turnedOn`|`turnedOff`。它们存在的理由是「设置页的图 90% 只关心一个方向」，
省掉每张图一个 Branch。

### 5.2 Self 节点 5 个（`switchNodes.ts`，分类 `Switch`，`scope.widgetElementTypes: ["nl.switch"]`）

| 类型 id | 标题 | 性质 | 引脚 |
|---|---|---|---|
| `blueprint.switch.getChecked` | Get Checked | pure | out `checked`(bool) |
| `blueprint.switch.setChecked` | Set Checked | latent | in `checked`(bool，allowInlineLiteral) |
| `blueprint.switch.toggle` | Toggle | latent | out `checked`(bool，切换后的新值) |
| `blueprint.switch.turnOn` | Turn On | latent | — |
| `blueprint.switch.turnOff` | Turn Off | latent | — |

### 5.3 Element 节点 5 个（分类 `Element`，`magicElementTarget.inputPinId = "switch"`）

| 类型 id | 标题 |
|---|---|
| `blueprint.element.switch.getChecked` | Get Switch Checked |
| `blueprint.element.switch.setChecked` | Set Switch Checked |
| `blueprint.element.switch.toggle` | Toggle Switch |
| `blueprint.element.switch.turnOn` | Turn Switch On |
| `blueprint.element.switch.turnOff` | Turn Switch Off |

`runtimeSwitchRef()` 照 `sliderNodes.ts:109` 抄：ref 存在就校验 `elementType` 与
`surfaceId`，`target === "element"` 且没 ref 就抛，`self` 则退回 `executionOwner.elementId`。

### 5.4 通用属性节点 8 个（`widgetPropertyNodes.ts` 一行生成）

`Get/Set Visible`、`Get/Set Enabled` 各 self + element 两套。
`WIDGET_TARGETS` 加一行即可，**不要**手写。

### 5.5 ⚠ `Toggle` 的数据输出是一颗雷

`toggle` 是 `isPure: false` 的节点却带 data 输出引脚。按 [[blueprint-exec-node-data-outputs]]，
这需要两件事一起做，缺一个就**静默返回 `undefined`**（`JSON.stringify` 还会把它整个吞掉，
看起来像下游节点没执行）：

1. `execute` 里调 `writeBlueprintNodeOutputValues` 写输出缓存；
2. `graphParamResolvers.ts` 的 `resolveSelfOutput` 里显式登记
   `selfNode.type === BLUEPRINT_NODE_TYPE_SWITCH_TOGGLE && portId === "checked"`。

`graphParamResolvers.test.ts` 会扫全注册表并对每个非 pure 节点的 data 输出种哨兵值，
漏登记直接红——**先跑它再说自己做完了**。

若不想沾这颗雷，退路是 `Toggle` 不给输出引脚，作者在后面接一个 `Get Checked`
（它读运行时 store，拿到的就是新值）。本卡选择给引脚 + 做对登记，
因为「切完立刻拿到新值」是这个节点最常见的用法。

---

## 6. 汉化

节点的标题 / 分类 / 引脚标签**不走 `t()`**：它们是节点定义里的英文字面量，
在渲染时由 `blueprintNodeI18n.ts` 的三张「英文原文 → TranslationKey」表翻译，
**查不到就原样返回英文，不报错、不警告**（[[blueprint-node-i18n-map]]）。

要加的键：

- `NODE_TITLE_KEYS`：新增 13 条（3 事件头 + 5 self + 5 element）。
  `Get Visible` / `Set Visible` / `Get Enabled` / `Set Enabled` 已在表里，
  `Get Switch Visible` 这类**元素版**是新串，要加 4 条。
- `CATEGORY_KEYS`：`"Switch": "blueprint.category.switch"`。
- `PORT_LABEL_KEYS`：`"Checked"`、`"Previous Checked"`、`"Switch"`。
- `catalog/en/blueprint.ts` 与 `catalog/zh/blueprint.ts` 各加对应条目
  （`TranslationKey` 类型只保 en，zh 靠 [[i18n-parity-test]] 的 parity 测试兜）。

⚠ **一个英文原文只能有一个中文。** 已核：`Toggle` / `Turn On` / `Turn Off` / `Changed` /
`Checked` / `Switch` 六个短串目前**都没被占用**（表里只有 `Toggle Dialog Display` 与
端口标签 `Toggle Fullscreen`，是不同的串）。若日后改名，旧键会继续对一个没人再产生的
英文原文生效——那种腐烂从代码里看不出来。
`blueprintNodeI18n.test.ts` 用「翻译器回显 key」遍历整个注册表，漏一条就红。

---

## 7. `checked` 的值绑定：给 `UIElementValueBindingValueType` 加 `"boolean"`

开关最想要的一件事是「这个开关就是偏好 X 的镜子」，也就是把 `checked`
绑到一张 Blueprint Value 图上。今天挡路的只有一个类型：

```ts
// document.ts:149
export type UIElementValueBindingValueType = "string" | "json" | "float";
```

勘验下来，加 `"boolean"` 的影响面小得出乎意料：

| 位置 | 要做什么 |
|---|---|
| `shared/types/ui-editor/document.ts:149` | 联合加 `"boolean"` |
| `BlueprintValueRuntimeStore.ts:79` `coerceValue` | 加一条 boolean 分支 |
| `BlueprintValueRuntimeStore.ts:160` `SUPPORTED_VALUE_TARGETS` | 加 `{ elementType: "nl.switch", propPath: "checked", valueType: "boolean" }` |
| `switch/inspector.tsx` | `createBlueprintValueField` 的 `renderLiteralEditor` 给一个勾选框 |
| `LocalBlueprintService.createValueGraphIr` | **已经支持**（`:182,200`），改的是把参数类型里那个 `\| "boolean"` 去掉 |
| `graphValidation.ts` | **不用动**（已核）：它只对 story `condition` 图强制 boolean 返回值（`:801`），从不拿控件绑定的 `valueType` 去校验 `widgetValue` 图 |

因为影响面跨出了开关，这一条**单独一个里程碑（M3）**，M1/M2 不依赖它。
M1 阶段检查器里的 `checked` 就是一个普通勾选框。

---

## 8. 里程碑

**M1 —— 控件能用**（清单 A + B）
插入得到一个开关，画布上点得动、切得过去、外观编辑器能改开态长相与过渡，
打包游戏里同样。此时还没有任何蓝图节点，`checked` 靠玩家点。

**M2 —— 节点全集**（清单 C + D + §6）
21 个节点、3 条事件、host API 两条能力。此时私有蓝图能读能写能收事件。

**M3 —— boolean 值绑定**（§7）
`checked` 可以绑图，开关成为偏好的镜子。

**M4 —— 打磨**（可延后）
拖拽 thumb 切换（iOS 手感）、docker bar 上的开/关预览按钮、
「重算行程」在 track 尺寸变化后主动提示。

---

## 9. 验收

按 [[orchestrator-visual-acceptance]]，界面验收必须在真 app 里亲眼看，
起法见 [[dev-app-cdp-drive]]，**不许抢前台**（[[cdp-acceptance-window-focus]]）。

必测的四条，前两条是这类控件最容易假绿的地方：

1. **同一个 Surface 上放两个开关，各自切换互不影响。**
   列表行那次事故（[[list-row-content-broken]]）就是「行数对、内容全一样」，
   而 `scopedWidgetRuntimeKey` 至今没有 instance 维度。开关放进列表模板时同样中招——
   M1 验收里明确写下「开关在列表行内不可寻址」这条已知限制，不要假装它好了。
2. **打包构建里再测一遍。** dev 构建带 `React.StrictMode`，
   value 绑定路径上 dev 与 packaged 行为**不同**（同上）。M3 的验收必须在打包产物里做。
3. 三条事件各命中一次：`changed` 拿到正确的 `Checked` / `Previous Checked`，
   `turnedOn` 只在开的方向、`turnedOff` 只在关的方向。
4. 删掉 `on` 变体的工程仍然能打开、能切换（退回「两态一个样」），不崩。

截图取证前先做一次标记测试——CDP 截图会返回旧帧且**长得完全像成功**
（[[cdp-screenshot-stale-frame]]）。
watcher 首轮构建期间驱动 app 会作废整轮验收（[[dev-watcher-invalidates-acceptance]]）。

样式方面：动手前读 `docs/design-system.md`，提交前跑 `node scripts/style-ratchet.mjs`
（CI verify 的第三道闸，六项债务计数只准降不准升）。检查器复用
`CompactModuleCard` / `Button` / `FieldLabel`，不要自造控件、不要写解释性长句。

---

## 10. 明确不做

| 不做 | 理由 |
|---|---|
| 竖向开关 | D4 |
| 三态 / indeterminate | 视觉小说的设置项没有第三态；真需要就是三个单选，不是开关 |
| 开关自带 ON/OFF 文字子槽 | D5，那是容器加两个文本的活 |
| `checked` 进 `AppearanceSystemCondition` | D6 |
| track 尺寸变化时自动重算行程 | D3，会把作者故意设的短行程悄悄改掉 |
| 让 `nl.switch` 出现在 `WIDGET_TARGETS` 的 `supportsVariant` | 开关本体不带外观模型 |

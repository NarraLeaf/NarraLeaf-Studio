# AssetSelector

面向工作区（Workspace）的模态资源选择器：按 `AssetType` 列出工程内资源，支持搜索、筛选、分组树、多选、本机导入、图片悬停预览，以及调用方提供的**虚拟分组**（内置项、预设等）。

实现文件：`AssetSelector.tsx`（通过 `createPortal` 渲染到 `document.body`）。

---

## 依赖与环境

| 依赖 | 说明 |
|------|------|
| `useWorkspace()` | 必须处于 Workspace 上下文内，用于 `context`、`isInitialized`。 |
| `useAssetData` | 加载 `assets` / `groups`，提供 `loadAssets`、loading / error。 |
| `useAssetFilters` | 提供筛选配置与 `filteredAssets` / `filteredGroups`（仅作用于**工程资源**）。 |
| `AssetsService` | 图片预览默认走 `fetch`；导入走 `importLocalAssets`。 |

若不在 Workspace 内挂载，数据与导入行为可能不可用（与 `context` 一致）。

---

## 导入

```ts
import {
    AssetSelector,
    type AssetSelectorProps,
    type AssetSelectorVirtualGroup,
} from "@/apps/workspace/modules/assets/components/AssetSelector";
```

类型 `Asset` 来自 `@/lib/workspace/services/assets/types`，`AssetType` 来自 `@/lib/workspace/services/assets/assetTypes`。

---

## 组件：`AssetSelector`

当 `visible === false` 时组件返回 `null`（不挂载面板与 portal）。

### Props 一览

| Prop | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `visible` | `boolean` | （必填） | 是否显示选择器。 |
| `assetType` | `AssetType` | （必填） | 当前选择的资源类型；标题默认图标与文案与此一致。 |
| `multiple` | `boolean` | `false` | 单选：点击一项即 `onConfirm` 并关闭；多选：底部显示 Choose / Clear。 |
| `selectedIds` | `string[]` | `[]` | 受控初始选中 id；在 `selectedIds` 或 `visible` 变化时会同步到内部 `selection`。 |
| `anchorRef` | `RefObject<HTMLElement \| null>` | 未传 | 有锚点时面板为 `position: absolute`，宽度在 320–480px 间随锚点宽度；无锚点时居中，宽约 420px。 |
| `title` | `string` | 按类型 | 覆盖默认标题 `Select {Images|Audio|…}`。 |
| `className` | `string` | `""` | 追加到面板根节点 class。 |
| `virtualGroups` | `AssetSelectorVirtualGroup[]` | 未传 | 虚拟分组（见下文）。 |
| `virtualGroupsPlacement` | `"before" \| "after"` | `"before"` | 虚拟分组相对工程资源树的位置。 |
| `resolveAssetPreviewUrl` | `(asset) => Promise<string \| null \| undefined>` | 未传 | 图片预览 URL 解析（见下文）。 |
| `onClose` | `() => void` | （必填） | 关闭（含点遮罩、点关闭按钮、单选确认后）。 |
| `onConfirm` | `(assets: Asset[]) => void` | （必填） | 单选：长度为 1；多选：点击 Choose 时传入当前选中项（顺序与 `selection` 迭代顺序相关）。 |

---

## 虚拟分组：`AssetSelectorVirtualGroup`

用于在工程资源树之外，由**调用方**注入可折叠区块（例如「内置字体」「预设贴图」）。

```ts
export interface AssetSelectorVirtualGroup {
    id: string; // 稳定唯一，用于展开状态
    title: string; // 分组标题（与工程文件夹行样式一致）
    assets: Asset[];
    defaultExpanded?: boolean; // 省略或为 true：打开选择器时默认展开；显式 false 则默认折叠
}
```

### 与工程列表的差异

| 能力 | 工程资源 | 虚拟分组内 `assets` |
|------|----------|---------------------|
| 顶部 **FilterSystem**（筛选芯片） | ✅ 参与 | ❌ 不参与；需调用方按业务自行缩减传入的 `assets` |
| **搜索框** | ✅ 按 name / description / tags 子串匹配（不区分大小写） | ✅ 同一套规则过滤各组内条目 |
| 分组树 / `groupId` | ✅ | ❌ 虚拟组内平铺，无子文件夹 |
| 导入（文件夹按钮） | ✅ 写入工程并 `loadAssets` | 不涉及 |
| 多选解析 | 从 `typeAssets` 查 id | 与工程合并进同一 `Map`（虚拟在后，同 id 会覆盖工程条目） |

### 展开状态的时机

- 每次 **`visible` 从 `false` → `true`**（重新打开选择器）时，会根据 `defaultExpanded !== false` 重置虚拟分组的展开集合。
- **同一次打开期间**，即使父组件重渲染导致 `virtualGroups` 引用变化，**不会**再次重置展开状态（内部用 ref 标记「本轮已打开」）。
- 建议对 `virtualGroups` 使用 `useMemo`，避免无意义引用抖动（虽不再重置展开，仍利于性能）。

### 头部「items」计数

当存在 `virtualGroups` 时，副标题为 **`typeAssets.length + 各组 assets 长度之和`**。若虚拟 id 与工程资源重复，计数可能语义重复；调用方应保持 id 唯一。

---

## 单选与多选

### 单选（`multiple` 省略或 `false`）

- 点击一行 → `onConfirm([asset])` → `onClose()`。
- 无底部栏。

### 多选（`multiple={true}`）

- 点击切换选中；底部 **Choose** 调用 `onConfirm(selectedAssets)` 后 `onClose()`。
- **selectedAssets** 由工程 `typeAssets` 与当前搜索过滤后的**虚拟** `virtualAssetsFlat` 合并成 `Map` 再按 `selection` 解析；虚拟条目必须能被 `id` 解析到。
- **Clear** 清空选择。

---

## 图片悬停预览

- 仅 `asset.type === AssetType.Image` 会触发。
- 约 **550ms** 延迟后加载预览，避免划过即请求。
- 解析顺序：**内存缓存** → `resolveAssetPreviewUrl`（若返回真值则缓存并展示）→ `assetsService.fetch` 生成 **blob URL**。

### `resolveAssetPreviewUrl` 建议

- 优先返回 **`https:`** 或 **`data:`** URL。卸载时仅对 **`blob:`** 缓存项调用 `URL.revokeObjectURL`；非 blob 不会误 revoke。
- 若返回自行创建的 `blob:` URL，组件仍会缓存；卸载时**会** revoke，请确保不与外部长期引用共享同一 blob URL。

---

## 布局与定位

- **有 `anchorRef.current`**：面板贴在锚点下方或上方（视视口空间），`width` clamp 到 320–480。
- **无锚点**：面板 `mt-12 mx-auto`，宽度 420。
- 最大高度约 **560px**，列表区域可滚动。
- `resize` / `scroll` / `ResizeObserver` 会触发重算位置。

---

## 工程资源列表结构（简要）

1. **`virtualGroupsPlacement === "before"`** 时先渲染虚拟分组块。
2. 根级 **AssetGroup**（`parentGroupId` 为空）：可折叠文件夹，内含该组下资源及子组递归。
3. `shouldRenderGroup`：仅当组内（含子组）存在当前 **搜索 + 筛选** 下可见资源时显示该文件夹，避免空壳文件夹。
4. 根级 **`groupId` 为空** 的资源与根文件夹同级展示（无「Ungrouped」标题）。
5. **孤儿资源**：`filteredTypeGroups` 为空 Map，但仍有 `displayedAssets` 且无法挂在 null 桶时，扁平列出（与分组元数据缺失等边界相关）。
6. **`virtualGroupsPlacement === "after"`** 时在工程树之后渲染虚拟分组。

---

## UI 状态

| 状态 | 表现 |
|------|------|
| `loading` | 全列表区域显示 Loading；**此时不展示虚拟分组与工程列表**（仅加载指示）。 |
| `error` | 错误文案；不展示列表。 |
| 工程无可见项且虚拟组搜索后也无可见项 | 「No assets match the current filters」。 |
| 工程加载失败但虚拟组有项 | 仍走 error 分支，虚拟组**不会**在 error 时显示。 |

---

## 本机导入

工具栏 **Import from disk** 调用 `assetsService.importLocalAssets(assetType)`，成功后 `loadAssets()`，并把新资源 id 并入当前 `selection`（多选语义下便于直接 Choose）。

---

## 虚拟资源 `Asset` 形状示例

虚拟条目须满足 `Asset` 类型，以便与选择器、预览、`onConfirm` 一致。本地资源最小示例（`AssetSource.Local`）：

```ts
import { AssetSource } from "@/lib/workspace/services/assets/types";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { Asset } from "@/lib/workspace/services/assets/types";

const builtinImage: Asset<AssetType.Image, AssetSource.Local> = {
    id: "builtin:checker",
    type: AssetType.Image,
    name: "Checker (built-in)",
    hash: "builtin-checker",
    source: AssetSource.Local,
    meta: {},
    tags: ["builtin", "preset"],
    description: "Procedural checker preview",
};
```

`id` 建议使用稳定前缀（如 `builtin:`），在 `onConfirm` 内与真实工程 UUID 区分处理。

---

## 完整示例

### 1. 最简单选（仅工程资源）

```tsx
const [open, setOpen] = useState(false);

<AssetSelector
    visible={open}
    assetType={AssetType.Image}
    onClose={() => setOpen(false)}
    onConfirm={(assets) => {
        const asset = assets[0];
        if (asset) applyImage(asset);
        setOpen(false);
    }}
/>;
```

### 2. 多选 + 初始选中

```tsx
<AssetSelector
    visible={open}
    assetType={AssetType.Font}
    multiple
    selectedIds={existingFontIds}
    onClose={() => setOpen(false)}
    onConfirm={(assets) => {
        setProjectFonts(assets.map((a) => a.id));
        setOpen(false);
    }}
/>
```

### 3. 锚定到触发按钮

```tsx
const anchorRef = useRef<HTMLButtonElement>(null);

<button ref={anchorRef} type="button" onClick={() => setOpen(true)}>
    Pick image
</button>
<AssetSelector
    visible={open}
    assetType={AssetType.Image}
    anchorRef={anchorRef}
    title="Choose hero image"
    onClose={() => setOpen(false)}
    onConfirm={(assets) => {
        /* ... */
    }}
/>
```

### 4. 虚拟分组 + 置后 + 预览解析

```tsx
const virtualGroups = useMemo<AssetSelectorVirtualGroup[]>(
    () => [
        {
            id: "presets",
            title: "Presets",
            defaultExpanded: true,
            assets: [presetAssetA, presetAssetB],
        },
        {
            id: "builtin",
            title: "Built-in",
            defaultExpanded: false,
            assets: [builtinImage],
        },
    ],
    [presetAssetA, presetAssetB, builtinImage],
);

<AssetSelector
    visible={open}
    assetType={AssetType.Image}
    virtualGroups={virtualGroups}
    virtualGroupsPlacement="after"
    resolveAssetPreviewUrl={async (asset) => {
        if (asset.id.startsWith("builtin:")) {
            // Prefer https: or data:; avoid returning caller-owned blob: unless you accept revoke on unmount.
            return "/your-app/builtin-thumb.png";
        }
        return undefined;
    }}
    onClose={() => setOpen(false)}
    onConfirm={(assets) => {
        const a = assets[0];
        if (!a) return;
        if (a.id.startsWith("builtin:")) applyBuiltinImage(a.id);
        else applyProjectImage(a);
    }}
/>
```

### 5. 筛选与虚拟组联动（调用方缩小虚拟列表）

FilterSystem 不改变虚拟组内容；若希望「只显示某筛选下的内置项」，在父组件根据 `activeFilters` 或业务状态过滤 `virtualGroups` 后再传入：

```tsx
const { activeFilters } = useMyFilterState();

const virtualGroups = useMemo(() => {
    const base = ALL_BUILTIN_GROUPS;
    if (!activeFilters.includeBuiltin) return [];
    return base;
}, [activeFilters.includeBuiltin]);
```

（示例中的 `useMyFilterState` 为伪代码，需接你应用内真实状态。）

---

## 相关文件

| 文件 | 作用 |
|------|------|
| `SearchBox.tsx` | 搜索输入。 |
| `FilterSystem.tsx` | 工程资源筛选芯片。 |
| `../state/useAssetData.ts` | 资源与分组数据。 |
| `../state/useAssetFilters.ts` | 过滤后的 assets/groups。 |

---

## 版本与维护

行为以 `AssetSelector.tsx` 源码为准；更新逻辑（例如 loading 时是否展示虚拟组）时请同步修改本文档。

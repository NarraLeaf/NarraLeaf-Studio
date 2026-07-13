# narraleaf-studio/plugin API 参考

studio entry 的完整 host API（`PluginApp`）。系统协议与加载链路见 [plugin.md](./plugin.md)，创建手册见 [create-plugin.md](./create-plugin.md)，runtime entry 的 API 见 [runtime-api.md](./runtime-api.md)。

studio entry 只在 workspace 窗口加载。插件 API 是一份显式白名单：`app.services` 只包含 `storage`、`assets`、`ui`、`widgets`、`blueprintNodes`、`story`；任何越界能力（工作区之外的文件系统、bash、权限授予）都必须经由 `app.privileged`，由主进程按插件身份逐次校验。插件通过白名单 API 完成的注册由宿主自动记录，插件卸载时会被强制回收，即使插件自身的 cleanup 遗漏了它们。

## 公共导入

```ts
import {
  definePlugin,
  ui,
  AssetType,
  AssetSource,
  PanelPosition,
  type PluginApp,
  type PluginCleanup,
  type PluginDefinition,
  type Asset,
  type AssetSelectorProps,
  type BlueprintInspectorParamSelectOption,
  type BlueprintNodeDef,
  type StoryBlock,
  type StoryPluginActionRegistration,
  type PluginInstallPermission,
  type PluginManifestV2,
  type NormalizedPluginManifestV2,
  type PluginManifestEntries,
  type PluginPermissionRequest,
  type PluginPermissionPromptResult,
} from "narraleaf-studio/plugin";
```

可用 runtime 值：

| 值 | 说明 |
| --- | --- |
| `definePlugin` | 声明插件入口。 |
| `ui` | Studio 公共 UI kit。 |
| `AssetType` | 工程资源类型枚举：`Image`、`Audio`、`Video`、`JSON`、`Blueprint`、`Font`、`Other`。 |
| `AssetSource` | 工程资源来源枚举：`Local`、`Remote`。 |
| `PanelPosition` | Panel 位置枚举：`Left`、`Right`、`Bottom`。 |

## PluginApp

```ts
type PluginApp = {
  plugin: PluginIdentity;
  manifest: NormalizedPluginManifestV2;
  services: PluginServices;
  privileged: BoundPrivilegedFacade;
};

type PluginIdentity = {
  id: string;
  name?: string;
  version?: string;
  publisher?: string;
};
```

`app.plugin` 是运行 descriptor 中的插件身份。`app.manifest` 是校验并补全默认值后的 manifest。

`setup` 可返回：

```ts
void
Promise<void>
() => void | Promise<void>
Promise<() => void | Promise<void>>
```

workspace 卸载时会执行返回的 cleanup，并撤销该插件 renderer 会话里的 privileged token。

## app.services.storage

项目级 JSON 存储（workspace service assets）。namespace 必须以插件 ID 为前缀。

```ts
const data = await app.services.storage.readJson<{ version: 1; items: unknown[] }>(
  `${app.plugin.id}.items`,
);

await app.services.storage.writeJson(`${app.plugin.id}.items`, { version: 1, items: [] });
```

`readJson` 找不到文件时返回 `null`，其他错误 throw。

## app.services.assets

工程资源的插件 facade。

```ts
app.services.assets.getMap();
app.services.assets.list(AssetType.Image);
app.services.assets.get(AssetType.Image, assetId);
app.services.assets.fetch(asset);          // 解码后的资源数据；失败 throw
app.services.assets.createObjectUrl(asset); // 远程资源返回远程 URL；本地资源创建 blob URL
app.services.assets.revokeObjectUrl(url);   // 不再展示时释放 blob URL
```

```tsx
function ImagePreview({ app, assetId }: { app: PluginApp; assetId: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const asset = app.services.assets.get(AssetType.Image, assetId);
    if (!asset) return;
    let localUrl: string | null = null;
    app.services.assets.createObjectUrl(asset).then((next) => {
      localUrl = next;
      setUrl(next);
    });
    return () => {
      if (localUrl) app.services.assets.revokeObjectUrl(localUrl);
    };
  }, [app, assetId]);

  return url ? <img src={url} alt="" /> : null;
}
```

## app.services.ui

### Panels

```ts
app.services.ui.panels.register(panel);
app.services.ui.panels.unregister(panelId);
```

```ts
type PanelDefinition<TPayload = unknown> = {
  id: string;
  title: string;
  icon: React.ReactNode;
  position: "left" | "right" | "bottom";
  component: React.ComponentType<{ panelId: string; payload?: TPayload }>;
  defaultVisible?: boolean;
  order?: number;
  badge?: string | number;
  payload?: TPayload;
};
```

### Actions

```ts
app.services.ui.actions.register(action);
app.services.ui.actions.unregister(actionId);
app.services.ui.actions.registerGroup(group);
app.services.ui.actions.unregisterGroup(groupId);
```

```ts
type ActionDefinition = {
  id: string;
  label?: string;
  icon?: React.ReactNode;
  tooltip?: string;
  shortcut?: string;
  onClick: (workspace: Workspace) => void;
  order?: number;
  disabled?: boolean;
  visible?: boolean;
  when?: (context: FocusContext) => boolean;
  badge?: string | number;
  group?: string;
  allowInEditable?: boolean;
};

type ActionGroup = {
  id: string;
  label: string;
  icon?: React.ReactNode;
  actions?: (ActionDefinition | ActionSeparator)[];
  items?: ActionMenuItem[];
  order?: number;
};

type ActionMenuItem = ActionDefinition | ActionSubmenu | ActionSeparator;
type ActionSubmenu = { id: string; label: string; icon?: React.ReactNode; items: ActionMenuItem[]; order?: number };
type ActionSeparator = { separator: true; order?: number };
```

### Editors

```ts
app.services.ui.editors.open(tab, groupId);
app.services.ui.editors.close(tabId, groupId);
```

```ts
type EditorTabDefinition<TPayload = unknown> = {
  id: string;
  title: string;
  icon?: React.ReactNode;
  component: React.ComponentType<{ tabId: string; payload?: TPayload }>;
  closable?: boolean;
  modified?: boolean;
  payload?: TPayload;
};
```

已打开的 tab 不会在插件卸载时被强制关闭（用户可见状态）。

### Keybindings

```ts
const dispose = app.services.ui.keybindings.register(keybinding);
const disposeMany = app.services.ui.keybindings.registerMany(keybindings);
```

```ts
type Keybinding = {
  id: string;
  key: string;
  description?: string;
  handler: (context: FocusContext) => void | Promise<void>;
  when?: (context: FocusContext) => boolean;
  allowInEditable?: boolean;
};

type FocusContext = {
  area: "left-panel" | "right-panel" | "bottom-panel" | "editor" | "editor-tabs" | "action-bar" | "dialog" | "none";
  targetId?: string;
};
```

### Notifications

```ts
app.services.ui.notifications.info(message);
app.services.ui.notifications.success(message);
app.services.ui.notifications.warning(message);
app.services.ui.notifications.error(message);
```

## app.services.widgets

```ts
app.services.widgets.register(module);
app.services.widgets.registerMany(modules);
app.services.widgets.get(type);
app.services.widgets.list();
app.services.widgets.has(type);
```

`UIWidgetModule` 定义 UI 编辑器控件：`type`（插件 ID 前缀）、`displayName`、`icon`、`createDefaultElement`、`render`、可选的 inspector/docker bar/context menu 工厂。完整类型见 `src/renderer/lib/ui-editor/widget-modules`。注意：插件 widget 目前只覆盖编辑面；游戏渲染面的插件 widget 属于后续阶段（见 plugin.md 执行环境矩阵）。

## app.services.blueprintNodes

```ts
app.services.blueprintNodes.register(def);
app.services.blueprintNodes.registerMany(defs);
const dispose = app.services.blueprintNodes.registerDynamicSelectOptionsSource(sourceId, provider);
app.services.blueprintNodes.notifyDynamicSelectOptionsChanged();
```

行为约束：

- node type 必须以插件 ID 为前缀，且必须在 manifest `contributes.blueprintNodes` 中声明（未声明的注册抛错）。
- studio 侧注册完整 `BlueprintNodeDef`（palette 元数据 + 编辑器预览 execute）；游戏 execute 由 runtime entry 用同一份定义注册（见 [runtime-api.md](./runtime-api.md)）。
- 动态 select 选项源 id 必须以插件 ID 为前缀；数据变化后调用 `notifyDynamicSelectOptionsChanged()`。

```ts
const sourceId = `${app.plugin.id}.items`;

const disposeOptions = app.services.blueprintNodes.registerDynamicSelectOptionsSource(
  sourceId,
  (): BlueprintInspectorParamSelectOption[] => [{ value: "item-a", label: "Item A" }],
);

app.services.blueprintNodes.register({
  type: `${app.plugin.id}.use-item`,
  displayName: "Use Item",
  category: "Plugin",
  graphKinds: ["event", "macro"],
  isPure: false,
  pins: [
    { id: "in", kind: "input", semantic: "exec", label: "In" },
    { id: "next", kind: "output", semantic: "exec", label: "Next" },
  ],
  inspectorParams: [
    { key: "itemId", label: "Item", kind: "select", dynamicOptionsSource: sourceId },
  ],
  execute: () => ({ nextPort: "next" }),
} satisfies BlueprintNodeDef);
```

`BlueprintNodeDef` / `BlueprintNodePinDef` / `BlueprintInspectorParamDef` 的完整字段见 `src/renderer/lib/ui-editor/blueprint-nodes/types.ts`（类型均从 `narraleaf-studio/plugin` 导出）。

## app.services.story

### actions

场景编辑器 Action Creator palette 的插件动作（显示在 Plugin 分类下）。

```ts
const dispose = app.services.story.actions.register({
  id: `${app.plugin.id}.insert-gallery-unlock`,
  label: "Unlock Gallery Item",
  detail: "Insert a blueprint block that unlocks a gallery item",
  createBlock: ({ generateId }) => ({
    id: generateId(),
    kind: "action",
    parentId: null,
    childrenIds: [],
    payload: { action: "blueprint" /* ... */ },
  }),
});
```

```ts
type StoryPluginActionRegistration = {
  id: string;        // 必须以插件 ID 为前缀
  label: string;
  detail?: string;
  group?: string;
  createBlock: (input: { generateId: () => string; initialText?: string }) => StoryBlock;
};
```

语义与边界：

- `createBlock` 返回**标准故事块**（`StoryBlock`），插入后与手工创建的块无异——文档不因此依赖插件，块的编译与执行走既有链路。
- 宿主对返回值做防御性归一（顶层 `parentId`/`childrenIds` 重置），并把 `createBlock` 抛错转为 workspace 通知。
- 需要游戏侧插件逻辑的动作应生成 Blueprint 块并在其中使用插件蓝图节点（运行时模式见 [runtime-api.md](./runtime-api.md)）。
- 注册由宿主追踪，插件卸载时自动回收。

## app.privileged

插件唯一的特权入口，主进程按 `{ kind: "plugin", pluginId, version }` actor 逐次校验。所有返回值都是 `Promise<RequestStatus<...>>`：外层表示 IPC 和权限层是否成功，内层 `FsRequestResult` 表示文件操作是否成功。

```ts
app.privileged.fs.stat(path);
app.privileged.fs.list(path);
app.privileged.fs.details(path);
app.privileged.fs.requestRead(path, encoding);
app.privileged.fs.requestReadRaw(path);
app.privileged.fs.requestWrite(path, encoding);
app.privileged.fs.requestWriteRaw(path);
app.privileged.fs.ensureRegularFile(path, data, encoding);
app.privileged.fs.writeFileNoFollow(path, data, encoding);
app.privileged.fs.recoverCorruptedJsonFile(path, replacement, encoding);
app.privileged.fs.createDir(path);
app.privileged.fs.deleteFile(path);
app.privileged.fs.deleteDir(path);
app.privileged.fs.rename(oldPath, newName, isDir);
app.privileged.fs.copyFile(src, dest);
app.privileged.fs.copyDir(src, dest);
app.privileged.fs.moveFile(src, dest);
app.privileged.fs.moveDir(src, dest);
app.privileged.fs.isFileExists(path);
app.privileged.fs.isDirExists(path);
app.privileged.fs.isFile(path);
app.privileged.fs.isDir(path);
app.privileged.fs.hash(path);
```

文件系统请求必须同时满足：manifest 或运行时权限请求已给当前 `pluginId@version` 授权；目标路径不在受保护的应用存储区域；当前窗口策略允许。

权限请求：

```ts
app.privileged.permissions.request(request);
```

插件只能为自己请求 `trust`、`filesystem` 或 `api` 权限；不能发起 `install` 请求，也不能替其他插件请求权限。`PluginPermissionRequest` 的完整形状从 `narraleaf-studio/plugin` 导出。

Bash：

```ts
app.privileged.bash.execute(command, cwd); // 权限检查已接入；handler 当前返回未实现
```

## Studio UI kit（`ui`）

插件边栏、编辑器 tab 和弹窗内容应使用 `ui` 组件，不要 import `@/lib/components/...` 或 workspace 内部路径。

| namespace | 接口 |
| --- | --- |
| `ui.Panel` | `Root`、`Header`、`Toolbar`、`Section`、`Row`、`EmptyState`。 |
| Controls | `Button`、`IconButton`、`Input`、`TextArea`、`SearchInput`、`InputGroup`、`Select`、`Combobox`、`SelectGroup`、`Switch`。 |
| Overlays | `Modal`、`ConfirmModal`、`AlertModal`、`ModalHeader`、`ModalBody`、`ModalFooter`、`ContextMenu`、`ContextMenuSeparator`、`useContextMenu`。 |
| Feedback | `Progress`、`ProgressIndeterminate`、`ProgressCircle`。 |
| Containers | `Accordion`、`AccordionItem`、`NestedAccordion`、`Card`、`CardHeader`、`CardTitle`、`CardDescription`、`CardContent`、`CardFooter`、`InteractiveCard`。 |
| Workspace | `AssetSelector`。 |

```tsx
import { PanelPosition, definePlugin, ui } from "narraleaf-studio/plugin";

function ToolsPanel() {
  return (
    <ui.Panel.Root>
      <ui.Panel.Header title="Tools" description="Plugin controls" actions={<ui.Button size="sm">Run</ui.Button>} />
      <ui.Panel.Toolbar>
        <ui.SearchInput size="sm" placeholder="Search" fullWidth />
      </ui.Panel.Toolbar>
      <ui.Panel.Section title="Options">
        <ui.Panel.Row label="Enable feature" control={<ui.Switch checked onCheckedChange={() => {}} />} />
      </ui.Panel.Section>
    </ui.Panel.Root>
  );
}
```

Panel primitives：

```ts
ui.Panel.Root(props: React.HTMLAttributes<HTMLDivElement> & { padded?: boolean });
ui.Panel.Header(props: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode });
ui.Panel.Toolbar(props: React.HTMLAttributes<HTMLDivElement>);
ui.Panel.Section(props: { title?: React.ReactNode; actions?: React.ReactNode });
ui.Panel.Row(props: { label?: React.ReactNode; description?: React.ReactNode; control?: React.ReactNode });
ui.Panel.EmptyState(props: { icon?: React.ReactNode; title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode });
```

### AssetSelector

`ui.AssetSelector` 复用 Studio 的工程资源树、搜索、筛选、导入和图片悬停预览。懒加载组件：第一次渲染可能短暂返回 `null`，保持 `visible` 为 `true` 即可。

```ts
type AssetSelectorProps = {
  visible: boolean;
  assetType: AssetType;
  multiple?: boolean;
  selectedIds?: string[];
  anchorRef?: React.RefObject<HTMLElement | null>;
  title?: string;
  className?: string;
  virtualGroups?: AssetSelectorVirtualGroup[];
  virtualGroupsPlacement?: "before" | "after";
  resolveAssetPreviewUrl?: (asset: Asset) => Promise<string | null | undefined>;
  onClose: () => void;
  onConfirm: (assets: Asset[]) => void;
};
```

## 已移除：app.services.get 与 app.services.workspace

旧版本曾通过 `app.services.get<T>(service)` 和 `app.services.workspace` 暴露 workspace 内部 service registry。这两个入口已移除：插件无法获取宿主内部 service 实例。如果白名单 API 无法覆盖你的场景：

- 涉及文件系统、bash、权限的操作走 `app.privileged`。
- 其他缺口请向 Studio 提 issue，由宿主以白名单 API 的形式补充，而不是恢复 registry 直通。

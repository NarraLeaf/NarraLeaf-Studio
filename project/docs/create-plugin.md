# Create a NarraLeaf Studio Plugin

本文给其他 agent 一份直接可执行的插件创建手册。不要在插件里解释系统原理；只创建一个本地、预打包、workspace-only 的 ESM 插件包。

## 快速规则

- 插件目录根部必须有 `manifest.json`。
- 插件入口必须是 ESM，并默认导出 `definePlugin({ setup(app) {} })`。
- `manifest.entry` 只能指向插件包内一个相对文件，推荐 `"main.js"`。
- Studio 只加载 `entry` 这一个文件；开发者必须自己打包源码和依赖。
- 运行时代码只从 `narraleaf-studio/plugin` 导入 Studio API；React 相关包使用 Studio host external。
- 所有插件贡献的 ID、widget type、blueprint node type、action id、panel id、keybinding id 都必须以插件 ID 为前缀。
- 不要 import `@/...`、preload、`getInterface()`、Electron API 或 Node API。需要特权能力时用 `app.privileged`。

## 文件结构

最小插件包：

```text
my-plugin/
  manifest.json
  main.js
```

带构建源码的插件包：

```text
my-plugin/
  manifest.json
  main.js
  assets/
  src/
    index.ts
  package.json
  tsconfig.json
  vite.config.ts
```

安装时选择插件包目录。Studio 会复制整个目录到 `userData/plugins/{pluginId}`，但 workspace 只通过 manifest 加载 `entry` 文件。

## manifest.json

```json
{
  "manifestVersion": 1,
  "id": "acme.panel-tools",
  "name": "Panel Tools",
  "version": "1.0.0",
  "publisher": "Acme",
  "description": "Workspace tools for NarraLeaf Studio.",
  "entry": "main.js",
  "permissions": [
    {
      "kind": "filesystem",
      "path": "/absolute/path/to/allowed-folder",
      "mode": "readwrite",
      "recursive": true
    }
  ]
}
```

Manifest 字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `manifestVersion` | `1` | 必须是 `1`。 |
| `id` | `string` | 必须是小写命名空间 ID，例如 `publisher.plugin-name`。 |
| `name` | `string` | 插件名称。 |
| `version` | `string` | `x.y.z` 格式，可带 prerelease/build 后缀。 |
| `publisher` | `string` | 可选。 |
| `description` | `string` | 可选。 |
| `entry` | `string` | 可选，默认 `main.js`；必须是包内相对路径。 |
| `permissions` | `PluginInstallPermission[]` | 可选，默认 `[]`。 |

`entry` 不能是绝对路径，不能包含 `..`、`.`、空字节、`?` 或 `#`。入口文件必须实际存在。

权限字段：

```ts
type PluginInstallPermission =
  | {
      kind: "filesystem";
      path: string;
      mode: "read" | "write" | "readwrite";
      recursive: boolean;
    }
  | {
      kind: "api";
      capability: string;
    };
```

当前可实际用于插件特权 facade 的 API capability：

| capability | 说明 |
| --- | --- |
| `bash.execute` | 授权检查已接入；V1 handler 当前仍返回未实现。 |

以下 capability 是 Studio 内部权限窗口和后续能力保留项，不要让普通插件声明：

```text
plugin.permission.grant
plugin.trust.grant
plugin.fs.grant
plugin.install.approve
```

文件系统权限的 `path` 是真实路径字符串。授权按 `pluginId@version` 保存；插件版本号改变后需要用户重新授权。

## main.js

最小入口：

```ts
import { definePlugin } from "narraleaf-studio/plugin";

export default definePlugin({
  setup(app) {
    app.services.ui.notifications.info(`${app.manifest.name} loaded`);
  },
});
```

带清理函数：

```ts
import { definePlugin } from "narraleaf-studio/plugin";

export default definePlugin({
  setup(app) {
    const disposeKeybinding = app.services.ui.keybindings.register({
      id: `${app.plugin.id}.hello`,
      key: "cmd+shift+h",
      description: "Show plugin greeting",
      handler: () => {
        app.services.ui.notifications.success("Hello from plugin");
      },
    });

    return () => {
      disposeKeybinding();
    };
  },
});
```

`setup` 可返回：

```ts
void
Promise<void>
() => void | Promise<void>
Promise<() => void | Promise<void>>
```

## 构建要求

如果用 TypeScript 或 React 编写插件，把源码打包为一个 ESM 入口。Studio 会提供 `narraleaf-studio/plugin` 和 React host runtime；这些包必须 external，避免把第二份 React 打进插件。

Vite 示例：

```ts
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: () => "main.js",
    },
    rollupOptions: {
      external: [
        "narraleaf-studio/plugin",
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
      ],
    },
  },
});
```

输出后把 `dist/main.js` 放到插件包根目录，或把 manifest 的 `entry` 指到输出位置。

不要 external `lucide-react`，除非 Studio 后续明确提供该 host module。插件可以自己 bundle 图标库，也可以先用文本按钮或传 `icon: null`。

## 安装和验证

1. 打开 Launcher。
2. 进入 Plugins。
3. 点击 Install Local。
4. 选择包含 `manifest.json` 的插件目录。
5. 点击 Approve Permissions。
6. 如果授权成功，插件会自动启用；也可以手动 Enable。
7. 打开 workspace。
8. 检查 workspace notification 和 Launcher 插件状态。

更新插件时提升 `manifest.version`，重新安装同一插件目录，然后重新授权。

## 公共导入

插件入口从 `narraleaf-studio/plugin` 导入：

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
  type PluginInstallPermission,
  type PluginManifestV1,
  type NormalizedPluginManifestV1,
  type PluginPermissionRequest,
  type PluginPermissionPromptResult,
} from "narraleaf-studio/plugin";
```

最小插件运行时代码只需要 `definePlugin`；需要 Studio 风格界面或资源选择时再使用 `ui`、`AssetType`、`AssetSource`。类型导入会在构建后擦除。

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
  manifest: NormalizedPluginManifestV1;
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

## Studio UI kit

插件边栏、编辑器 tab 和弹窗内容应使用 `ui` 组件，避免直接使用内部路径。`ui` 组件与 Studio 当前深色界面、字号、间距、hover/focus 状态保持一致。

```tsx
import { PanelPosition, definePlugin, ui } from "narraleaf-studio/plugin";
import { useState } from "react";

function ToolsPanel() {
  const [enabled, setEnabled] = useState(false);

  return (
    <ui.Panel.Root>
      <ui.Panel.Header
        title="Tools"
        description="Plugin controls"
        actions={<ui.Button size="sm">Run</ui.Button>}
      />

      <ui.Panel.Toolbar>
        <ui.SearchInput size="sm" placeholder="Search" fullWidth />
      </ui.Panel.Toolbar>

      <ui.Panel.Section title="Options">
        <ui.Panel.Row
          label="Enable feature"
          description="Applies only to this workspace session."
          control={<ui.Switch checked={enabled} onCheckedChange={setEnabled} />}
        />
      </ui.Panel.Section>
    </ui.Panel.Root>
  );
}

export default definePlugin({
  setup(app) {
    app.services.ui.panels.register({
      id: `${app.plugin.id}.tools`,
      title: "Tools",
      icon: null,
      position: PanelPosition.Right,
      component: ToolsPanel,
    });

    return () => app.services.ui.panels.unregister(`${app.plugin.id}.tools`);
  },
});
```

公共组件：

| namespace | 接口 |
| --- | --- |
| `ui.Panel` | `Root`、`Header`、`Toolbar`、`Section`、`Row`、`EmptyState`。 |
| Controls | `Button`、`IconButton`、`Input`、`TextArea`、`SearchInput`、`InputGroup`、`Select`、`Combobox`、`SelectGroup`、`Switch`。 |
| Overlays | `Modal`、`ConfirmModal`、`AlertModal`、`ModalHeader`、`ModalBody`、`ModalFooter`、`ContextMenu`、`ContextMenuSeparator`、`useContextMenu`。 |
| Feedback | `Progress`、`ProgressIndeterminate`、`ProgressCircle`。 |
| Containers | `Accordion`、`AccordionItem`、`NestedAccordion`、`Card`、`CardHeader`、`CardTitle`、`CardDescription`、`CardContent`、`CardFooter`、`InteractiveCard`。 |
| Workspace | `AssetSelector`。 |

Panel primitives：

```ts
ui.Panel.Root(props: React.HTMLAttributes<HTMLDivElement> & { padded?: boolean });
ui.Panel.Header(props: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
});
ui.Panel.Toolbar(props: React.HTMLAttributes<HTMLDivElement>);
ui.Panel.Section(props: {
  title?: React.ReactNode;
  actions?: React.ReactNode;
});
ui.Panel.Row(props: {
  label?: React.ReactNode;
  description?: React.ReactNode;
  control?: React.ReactNode;
});
ui.Panel.EmptyState(props: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
});
```

基础组件类型从 `narraleaf-studio/plugin` 导出，例如：

```ts
import type {
  ButtonProps,
  SelectOption,
  SelectProps,
  SwitchProps,
  AssetSelectorProps,
} from "narraleaf-studio/plugin";
```

## AssetSelector

使用 `ui.AssetSelector` 复用 Studio 的工程资源选择器。它支持搜索、筛选、分组树、多选、本机导入、图片悬停预览和虚拟分组。

```tsx
import { definePlugin, ui, AssetType, type Asset } from "narraleaf-studio/plugin";
import { useRef, useState } from "react";

function AssetPanel() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Asset | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);

  return (
    <ui.Panel.Root>
      <ui.Panel.Header title="Asset Picker" />
      <div ref={anchorRef}>
        <ui.Button size="sm" onClick={() => setOpen(true)}>
          {selected ? selected.name : "Choose image"}
        </ui.Button>
      </div>
      <ui.AssetSelector
        visible={open}
        assetType={AssetType.Image}
        selectedIds={selected ? [selected.id] : []}
        anchorRef={anchorRef}
        onClose={() => setOpen(false)}
        onConfirm={(assets) => {
          setSelected(assets[0] ?? null);
          setOpen(false);
        }}
      />
    </ui.Panel.Root>
  );
}
```

核心 props：

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

`ui.AssetSelector` 是懒加载组件；第一次渲染时可能短暂返回 `null`，保持 `visible` 为 `true` 即可让它完成加载后显示。

## app.services.assets

```ts
app.services.assets.getMap();
app.services.assets.list(AssetType.Image);
app.services.assets.get(AssetType.Image, assetId);
app.services.assets.fetch(asset);
app.services.assets.createObjectUrl(asset);
app.services.assets.revokeObjectUrl(url);
```

`fetch(asset)` 返回解码后的资源数据，失败时 throw。`createObjectUrl(asset)` 对远程资源返回远程 URL，对本地资源创建 blob URL；插件组件卸载或图片替换时调用 `revokeObjectUrl(url)`。

示例：

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

## app.services.storage

使用 project service-assets 保存插件自己的项目级 JSON。

```ts
const data = await app.services.storage.readJson<{ version: 1; items: unknown[] }>(
  `${app.plugin.id}.items`,
);

await app.services.storage.writeJson(`${app.plugin.id}.items`, {
  version: 1,
  items: [],
});
```

`readJson` 找不到文件时返回 `null`。namespace 必须以插件 ID 为前缀。

## app.services.ui

### Panels

```ts
app.services.ui.panels.register(panel);
app.services.ui.panels.unregister(panelId);
```

Panel definition：

```ts
type PanelDefinition<TPayload = unknown> = {
  id: string;
  title: string;
  icon: React.ReactNode;
  position: "left" | "right" | "bottom";
  component: React.ComponentType<{
    panelId: string;
    payload?: TPayload;
  }>;
  defaultVisible?: boolean;
  order?: number;
  badge?: string | number;
  payload?: TPayload;
};
```

示例：

```ts
app.services.ui.panels.register({
  id: `${app.plugin.id}.panel`,
  title: "Tools",
  icon: null,
  position: "right",
  component: () => null,
  order: 200,
});
```

### Actions

```ts
app.services.ui.actions.register(action);
app.services.ui.actions.unregister(actionId);
app.services.ui.actions.registerGroup(group);
app.services.ui.actions.unregisterGroup(groupId);
```

Action group：

```ts
type ActionGroup = {
  id: string;
  label: string;
  icon?: React.ReactNode;
  actions?: (ActionDefinition | ActionSeparator)[];
  items?: ActionMenuItem[];
  order?: number;
};
```

Action：

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
```

Menu item：

```ts
type ActionMenuItem = ActionDefinition | ActionSubmenu | ActionSeparator;

type ActionSubmenu = {
  id: string;
  label: string;
  icon?: React.ReactNode;
  items: ActionMenuItem[];
  order?: number;
};

type ActionSeparator = {
  separator: true;
  order?: number;
};
```

### Editors

```ts
app.services.ui.editors.open(tab, groupId);
app.services.ui.editors.close(tabId, groupId);
```

Editor tab：

```ts
type EditorTabDefinition<TPayload = unknown> = {
  id: string;
  title: string;
  icon?: React.ReactNode;
  component: React.ComponentType<{
    tabId: string;
    payload?: TPayload;
  }>;
  closable?: boolean;
  modified?: boolean;
  payload?: TPayload;
};
```

### Keybindings

```ts
const dispose = app.services.ui.keybindings.register(keybinding);
const disposeMany = app.services.ui.keybindings.registerMany(keybindings);
```

Keybinding：

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
  area:
    | "left-panel"
    | "right-panel"
    | "bottom-panel"
    | "editor"
    | "editor-tabs"
    | "action-bar"
    | "dialog"
    | "none";
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

这些是简化入口。如果需要按钮、timeout、severity 等完整通知能力，使用高级 `Services.UI`。

## app.services.widgets

```ts
app.services.widgets.register(module);
app.services.widgets.registerMany(modules);
app.services.widgets.get(type);
app.services.widgets.list();
app.services.widgets.has(type);
```

Widget module：

```ts
type UIWidgetModule = {
  readonly type: string;
  readonly logicApi?: WidgetLogicApi;
  readonly displayName: string;
  readonly icon: LucideIcon;
  createDefaultElement(): Partial<UIElement>;
  createDefaultChildElements?(context: DefaultChildElementContext): DefaultChildElementResult;
  render(props: WidgetRendererProps): React.ReactElement | null;
  createInspector?(context: InspectorContext): PropertyEditorSchema<UIInspectorData> | undefined;
  createDockerBarItems?(context: DockerBarContext): DockerBarItem[];
  createMultiSelectDockerBarItems?(context: DockerBarContext): DockerBarItem[];
  createContextMenuItems?(context: WidgetContextMenuContext): ContextMenuItemDef[];
  createFloatingToolbarItems?(context: FloatingToolbarContext): FloatingToolbarItem[];
  createLayoutSizeField?(context: LayoutSizeFieldContext): FieldDefinition<UIInspectorData> | null | undefined;
  registerBlueprintNodes?(): void;
};
```

常用上下文：

```ts
type WidgetRendererProps = {
  element: UIElement;
  surface: UISurface;
  document: UIDocument;
  hostAdapter: UIHostAdapter;
  children?: React.ReactNode;
  instanceKey?: string;
  renderChildren?: (options?: {
    childrenIds?: string[];
    listItemScope?: UIListItemScope | null;
    instanceKey?: string;
    elementOverrides?: Record<string, UIElement>;
  }) => React.ReactNode[];
  renderSurface?: (options: {
    targetSurfaceId: string | null;
    frameElement: UIElement;
    params?: Record<string, unknown>;
    instanceKey?: string;
  }) => React.ReactNode;
  runtimeData?: {
    surfaceState?: { get(key: string): unknown };
    globalState?: { get(key: string): unknown };
  };
  useAppearanceInspectorPreview?: boolean;
};

type UIInspectorData = {
  element: UIElement;
  elements: UIElement[];
  documentService: UIDocumentService;
  surfaceId?: string;
};

type InspectorContext = {
  element: UIElement;
  documentService: UIDocumentService;
};
```

Docker bar item：

```ts
type DockerBarItem =
  | {
      kind: "button";
      id: string;
      icon?: LucideIcon;
      label?: string;
      tooltip?: string;
      disabled?: boolean;
      active?: boolean;
      onClick: () => void;
    }
  | {
      kind: "select";
      id: string;
      label?: string;
      tooltip?: string;
      value: string | number;
      options: { value: string | number; label: string }[];
      onChange: (value: string | number) => void;
    }
  | {
      kind: "number";
      id: string;
      label?: string;
      tooltip?: string;
      value: number;
      min?: number;
      max?: number;
      step?: number;
      disabled?: boolean;
      readOnly?: boolean;
      onChange: (value: number) => void;
      placeholder?: string;
      inputProps?: React.InputHTMLAttributes<HTMLInputElement>;
    }
  | {
      kind: "separator";
      id: string;
    };
```

## app.services.blueprintNodes

```ts
app.services.blueprintNodes.register(def);
app.services.blueprintNodes.registerMany(defs);
const dispose = app.services.blueprintNodes.registerDynamicSelectOptionsSource(sourceId, provider);
app.services.blueprintNodes.notifyDynamicSelectOptionsChanged();
```

动态 select 选项：

```ts
const sourceId = `${app.plugin.id}.items`;

const disposeOptions = app.services.blueprintNodes.registerDynamicSelectOptionsSource(
  sourceId,
  (): BlueprintInspectorParamSelectOption[] => [
    { value: "item-a", label: "Item A" },
  ],
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
    {
      key: "itemId",
      label: "Item",
      kind: "select",
      dynamicOptionsSource: sourceId,
    },
  ],
  execute: () => ({ nextPort: "next" }),
} satisfies BlueprintNodeDef);

app.services.blueprintNodes.notifyDynamicSelectOptionsChanged();
```

数据变化后调用 `notifyDynamicSelectOptionsChanged()`。插件 cleanup 里调用 `disposeOptions()`。

Blueprint node definition：

```ts
type BlueprintNodeDef = {
  type: string;
  displayName: string;
  category: string;
  keywords?: string[];
  graphKinds: BlueprintGraphKind[];
  hideInPalette?: boolean;
  magicElementTarget?: {
    inputPinId: string;
    elementTypes?: readonly string[];
  };
  isPure: boolean;
  requiresListItemContext?: boolean;
  isLatent?: boolean;
  pins: BlueprintNodePinDef[];
  dynamicInputPins?: BlueprintNodeDynamicInputPinsConfig;
  inspectorParams?: BlueprintInspectorParamDef[];
  scope?: BlueprintNodeScope;
  role?:
    | "normal"
    | "eventHead"
    | "functionEntry"
    | "reroute"
    | "dataLiteral"
    | "elementLiteral"
    | "elementEventHead"
    | "imageAssetLiteral"
    | "valueReturn"
    | "comment";
  execute: BlueprintNodeExecuteFn;
};
```

Pins：

```ts
type BlueprintNodePinDef = {
  id: string;
  kind: "input" | "output";
  semantic: "exec" | "data";
  valueType?: string;
  label?: string;
  allowInlineLiteral?: boolean;
};
```

Inspector params：

```ts
type BlueprintInspectorParamDef = {
  key: string;
  label: string;
  kind:
    | "string"
    | "number"
    | "json"
    | "color"
    | "keyboardBinding"
    | "literal"
    | "variableRef"
    | "persistentVariableRef"
    | "select"
    | "imageAsset";
  jsonSchema?: BlueprintJsonValueSchema;
  options?: { value: string; label: string; meta?: Record<string, string> }[];
  dynamicOptionsSource?: string;
  dynamicOptionsFilter?: {
    paramKey: string;
    optionMetaKey: string;
  };
};
```

## app.privileged

所有返回值都是 `Promise<RequestStatus<...>>`。外层 `RequestStatus` 表示 IPC 和权限层是否成功；内层 `FsRequestResult` 表示文件操作是否成功。

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

权限请求：

```ts
app.privileged.permissions.request(request);
app.privileged.permissions.revokePlugin(pluginId);
```

插件只能为自己请求 `trust`、`filesystem` 或 `api` 权限；已安装插件不能发起 `install` 请求，也不能替其他插件请求权限。`revokePlugin` 只允许默认 app facade 使用，普通插件调用会被拒绝。

Permission request：

```ts
type PluginPermissionRequest =
  | {
      kind: "trust";
      requestId: string;
      plugin: PluginIdentity;
      reason?: string;
      requestedAt?: number;
      persistence?: "temporary" | "permanent";
    }
  | {
      kind: "filesystem";
      requestId: string;
      plugin: PluginIdentity;
      path: string;
      mode: "read" | "write" | "readwrite";
      recursive: boolean;
      persistence: "temporary" | "permanent";
      reason?: string;
      requestedAt?: number;
    }
  | {
      kind: "api";
      requestId: string;
      plugin: PluginIdentity;
      capability: string;
      persistence?: "temporary" | "permanent";
      reason?: string;
      requestedAt?: number;
    };
```

Bash：

```ts
app.privileged.bash.execute(command, cwd);
```

V1 当前会经过权限检查，然后返回未实现错误。

## 已移除：app.services.get 与 app.services.workspace

旧版本曾通过 `app.services.get<T>(service)` 和 `app.services.workspace` 暴露 workspace 内部 service registry。这两个入口已移除：插件 API 现在是一份显式白名单（`storage`、`assets`、`ui`、`widgets`、`blueprintNodes`），插件无法再获取宿主内部 service 实例。

如果白名单 API 无法覆盖你的场景：

- 涉及文件系统、bash、权限的操作走 `app.privileged`（主进程按插件身份逐次校验）。
- 其他缺口请向 Studio 提 issue，由宿主以白名单 API 的形式补充，而不是恢复 registry 直通。

### project

```ts
getProjectConfig(): ProjectConfig;
```

### uuid

```ts
generate(compact?: boolean): string;
```

### fileSystem

```ts
stat(path): Promise<FsRequestResult<FileStat>>;
list(path): Promise<FsRequestResult<FileStat[]>>;
details(path): Promise<FsRequestResult<FileDetails>>;
read(path, encoding): Promise<FsRequestResult<string>>;
readRaw(path): Promise<FsRequestResult<Uint8Array>>;
write(path, data, encoding): Promise<FsRequestResult<void>>;
writeRaw(path, data): Promise<FsRequestResult<void>>;
ensureRegularFile(path, data, encoding): Promise<FsRequestResult<void>>;
writeFileNoFollow(path, data, encoding): Promise<FsRequestResult<void>>;
recoverCorruptedJsonFile(path, replacement, encoding): Promise<FsRequestResult<void>>;
createDir(path): Promise<FsRequestResult<void>>;
deleteFile(path): Promise<FsRequestResult<void>>;
deleteDir(path): Promise<FsRequestResult<void>>;
rename(oldPath, newPath, isDir): Promise<FsRequestResult<void>>;
copyFile(src, dest): Promise<FsRequestResult<void>>;
copyDir(src, dest): Promise<FsRequestResult<void>>;
moveFile(src, dest): Promise<FsRequestResult<void>>;
moveDir(src, dest): Promise<FsRequestResult<void>>;
isFileExists(path): Promise<FsRequestResult<boolean>>;
isDirExists(path): Promise<FsRequestResult<boolean>>;
isFile(path): Promise<FsRequestResult<boolean>>;
isDir(path): Promise<FsRequestResult<boolean>>;
readJSON<T>(path): Promise<FsRequestResult<T>>;
```

### ui

简化 facade 已覆盖常用注册。如果需要完整 UI service：

```ts
showConfirm(message, detail?): Promise<boolean>;
showAlert(message, detail?): Promise<void>;
showNotification(message, type?): void;
showError(error): void;
```

具体实现实例还包含 `notifications`、`actionBar`、`panels`、`editor`、`dialogs`、`statusBar`、`focus`、`keybindings`、`getStore()`、`getEvents()`，这些属于内部 API，优先使用 `app.services.ui`。

### globalSettings

```ts
get<T>(key, defaultValue?): Promise<T | undefined>;
set<T>(key, value): Promise<void>;
setBatch(settings): Promise<void>;
getAll(): Record<string, any>;
has(key): boolean;
getSync<T>(key, defaultValue?): T | undefined;
```

### serviceAssets

```ts
writeStore<T>(namespace, data): Promise<FsRequestResult<{ path: string }>>;
readStore<T>(namespace): Promise<FsRequestResult<T>>;
writeFile(data): Promise<FsRequestResult<string>>;
readFile(fileId, encoding?): Promise<FsRequestResult<string>>;
readRaw(fileId): Promise<FsRequestResult<Uint8Array>>;
deleteFile(fileId): Promise<FsRequestResult<void>>;
```

### panelState

```ts
getPanelState<T>(panelId): T | undefined;
setPanelState<T>(panelId, partial): void;
replacePanelState<T>(panelId, next): void;
```

### uiDocument

```ts
load(): Promise<UIDocument>;
save(document): Promise<void>;
getDocument(): UIDocument;
onDocumentChanged(handler): () => void;
onDirtyChanged(handler): () => void;
isDirty(): boolean;
getRevision(): number;
setAfterMutateHook(hook): void;
restoreDocumentFromHistory(document, options?): void;
runSurfaceHistoryTransaction(surfaceId, action): void;
updateElementLayout(elementId, layoutPatch, options?): void;
updateElementLayouts(layoutPatches): void;
updateElementProps(elementId, propsPatch): void;
ensureElementBlueprintValueBinding(elementId, propPath, input): { blueprintId: string };
clearElementBlueprintValueBinding(elementId, propPath): void;
updateElementExtra(elementId, extraPatch): void;
reorderChildren(parentId, orderedChildIds): void;
createSurface(input): UISurface;
deleteSurface(surfaceId): void;
renameSurface(surfaceId, name): void;
updateSurface(surfaceId, updater): void;
getComponent(componentId): UIComponentDefinition | undefined;
getComponentUsageCount(componentId): number;
createEmptyComponent(name?): UIComponentDefinition;
createComponentFromElements(surfaceId, elementIds, name?): UIComponentDefinition | null;
renameComponent(componentId, name): void;
deleteComponents(componentIds): void;
duplicateComponent(componentId): UIComponentDefinition | null;
updateComponentElementLayout(componentId, elementId, layoutPatch): void;
updateComponentElementProps(componentId, elementId, propsPatch): void;
updateComponentElementExtra(componentId, elementId, extraPatch): void;
setComponentElementBlueprintEvent(componentId, elementId, eventName, ref): void;
clearComponentElementBlueprintEvent(componentId, elementId, eventName): void;
stripComponentBlueprintLayerBindings(componentId, blueprintId, layerEventId): void;
renameComponentElement(componentId, elementId, name): void;
reorderComponentChildren(componentId, parentId, orderedChildIds): void;
deleteComponentElements(componentId, elementIds): void;
moveComponentElements(componentId, elementIds, targetParentId, beforeChildId): MoveUiElementsResult;
createComponentElement(componentId, parentId, type, layoutPatch?): UIElement | null;
pasteComponentClipboardPayload(componentId, targetParentId, beforeChildId, payload): PasteResult;
createComponentInstance(parentId, componentId, layoutPatch?): UIElement;
unlinkComponentInstance(elementId): string[];
createElement(parentId, type, layoutPatch?): UIElement;
deleteElements(elementIds): void;
moveElementsInSurface(surfaceId, elementIds, targetParentId, beforeChildId): MoveUiElementsResult;
pasteClipboardPayload(surfaceId, targetParentId, beforeChildId, payload): PasteResult;
renameElement(elementId, name): void;
setElementBlueprintEvent(elementId, eventName, ref): void;
clearElementBlueprintEvent(elementId, eventName): void;
stripBlueprintLayerBindings(surfaceId, blueprintId, layerEventId): void;
```

### runtimeBridge

```ts
renderSurface(options): React.ReactElement | null;
renderDocumentSurface(options): React.ReactElement | null;
renderComponent(options): React.ReactElement | null;
registerElementRenderer(definition): void;
```

### uiEditorState

```ts
getTool(): UITool;
setTool(tool): void;
getViewportTransform(): ViewportTransform;
updateViewport(transform): ViewportTransform;
resetViewport(): ViewportTransform;
getSelection(): SelectionState;
setSelection(selection): void;
setUIElementSelection(selection): void;
getDocument(): UIDocument;
getSurface(surfaceId): UISurface | undefined;
getAppearanceInspectorVariant(elementId): string | null;
setAppearanceInspectorVariant(elementId, variantId): void;
getAppearanceBorderSidesExpanded(elementId): boolean;
setAppearanceBorderSidesExpanded(elementId, expanded): void;
isOutlineBranchCollapsed(elementId): boolean;
setOutlineBranchCollapsed(elementId, collapsed): void;
getOutlinePanelCollapsed(): boolean;
setOutlinePanelCollapsed(collapsed): void;
getSmartSnapEnabled(): boolean;
setSmartSnapEnabled(enabled): void;
getSmartSnapDetailSettings(): SmartSnapDetailSettings;
patchSmartSnapDetailSettings(patch): void;
getSnapGuides(): ActiveSnapGuides | null;
setSnapGuides(guides): void;
on(event, handler): () => void;
```

### uiEditorHistory

```ts
getLimit(): number;
setLimit(limit): void;
captureSnapshot(surfaceId): { document: UIDocument; blueprint: unknown };
record(options): void;
canUndo(surfaceId): boolean;
canRedo(surfaceId): boolean;
undo(surfaceId): boolean;
redo(surfaceId): boolean;
clear(surfaceId?): void;
on("historyChanged", handler): () => void;
```

### uiGraph

```ts
load(): Promise<UIGraphDocument>;
save(document): Promise<void>;
getDocument(): UIGraphDocument;
onGraphsChanged(handler): () => void;
onDirtyChanged(handler): () => void;
isDirty(): boolean;
getRevision(): number;
applyGraphMutation(mutator): void;
createGraph(input): UIGraph;
updateGraph(graphId, updater): void;
deleteGraph(graphId): void;
```

### localBlueprint

```ts
getBlueprintDocument(): BlueprintDocument;
applyBlueprintMutation(mutator): void;
getBlueprintHistoryLimit(): number;
setBlueprintHistoryLimit(limit): void;
captureBlueprintHistorySnapshot(blueprintId, ownerKey?): Snapshot;
runBlueprintHistoryTransaction(blueprintId, action, options?): unknown;
canUndoBlueprint(blueprintId): boolean;
canRedoBlueprint(blueprintId): boolean;
undoBlueprint(blueprintId): boolean;
redoBlueprint(blueprintId): boolean;
clearBlueprintHistory(blueprintId?): void;
onBlueprintHistoryChanged(handler): () => void;
ensureSurfaceMain(surfaceId, displayName?): string;
removeSurfaceAndWidgetOwners(surfaceId): void;
ensureWidgetMain(surfaceId, elementId, displayName?, widgetType?): string;
removeWidgetMain(surfaceId, elementId): void;
getWidgetMainBlueprintId(surfaceId, elementId): string | undefined;
ensureComponentWidgetMain(componentId, elementId, displayName?, widgetType?): string;
removeComponentWidgetMain(componentId, elementId): void;
getComponentWidgetMainBlueprintId(componentId, elementId): string | undefined;
ensureWidgetValueBlueprint(input): string;
removeWidgetValueBlueprint(surfaceId, elementId, propPath): void;
getWidgetValueBlueprintId(surfaceId, elementId, propPath): string | undefined;
getSurfaceMainBlueprintId(surfaceId): string | undefined;
getReadonlySurfaceMainSummary(surfaceId): ReadonlyBlueprintSurfaceSummary;
getReadonlyComponentWidgetMainSummary(componentId, element): ReadonlyBlueprintWidgetSummary;
createField(blueprintId, input): BlueprintField;
setFieldValueSource(blueprintId, fieldId, valueSource): void;
renameField(blueprintId, fieldId, name): void;
deleteField(blueprintId, fieldId): void;
setWidgetPropBinding(params): string;
clearWidgetPropBinding(blueprintId, surfaceId, elementId, propPath): void;
findWidgetPropBinding(blueprintId, surfaceId, elementId, propPath): BindingDefinition | undefined;
listFields(blueprintId): BlueprintField[];
createBlueprintVariable(blueprintId, input?): BlueprintVariable;
createPersistentVariable(historyBlueprintId, input?): BlueprintPersistentVariable;
renamePersistentVariable(historyBlueprintId, variableId, name): void;
setPersistentVariableDefault(historyBlueprintId, variableId, defaultValue): void;
deletePersistentVariable(historyBlueprintId, variableId): void;
renameBlueprintVariable(blueprintId, variableId, name): void;
setBlueprintVariableDefault(blueprintId, variableId, defaultValue): void;
deleteBlueprintVariable(blueprintId, variableId): void;
ensureEventGraph(blueprintId, eventId, displayName?): void;
adoptLegacyEventGraphToSlot(blueprintId, slotId, legacyEventId, displayName?): void;
renameEventGraph(blueprintId, eventId, displayName): void;
removeEventGraph(blueprintId, eventId): void;
listEventGraphIds(blueprintId): string[];
ensureFunctionGraph(blueprintId, functionId, displayName?): void;
removeFunctionGraph(blueprintId, functionId): void;
listFunctionGraphIds(blueprintId): string[];
updateEventGraphIr(blueprintId, eventId, updater, options?): void;
updateFunctionGraphIr(blueprintId, functionId, updater, options?): void;
updateScriptModuleSource(blueprintId, code, options?): void;
getReadonlyWidgetMainSummary(surfaceId, element): ReadonlyBlueprintWidgetSummary;
planSubtreeDuplicateBlueprintRemap(input): SubtreeDuplicateRemapPlan;
listPrivateBlueprintIdsForOwnerKey(ownerKey): string[];
setActivePrivateBlueprintForOwnerKey(ownerKey, blueprintId): void;
createSiblingPrivateBlueprintForOwnerKey(ownerKey, frontend): string;
```

### uiBlueprintLifecycle

```ts
syncFromUidoc(): void;
```

### devMode

```ts
getStatus(): DevModeStatus;
refreshStatus(): Promise<DevModeStatus>;
launch(entry, projectPath?): Promise<DevModeStatus>;
stop(): Promise<DevModeStatus>;
reload(): Promise<DevModeStatus>;
onStatusChanged(handler): () => void;
```

### uiEditorFontFace

```ts
acquire(assetId): Promise<{ ok: true; cssFamily: string } | { ok: false; error: string }>;
release(assetId): void;
invalidate(assetId): void;
```

### blueprintNodeCatalog

```ts
ensureBuiltinsRegistered(): void;
register(def): void;
registerMany(defs): void;
get(type): BlueprintNodeDef | undefined;
getBlueprintNodeEditorCatalogEntry(type): BlueprintNodeEditorCatalogEntry | undefined;
listPaletteEntries(ctx): BlueprintNodeEditorCatalogEntry[];
resolveCatalogEntry(type): BlueprintNodeEditorCatalogEntry;
resolveCatalogEntryForNode(type, params?): BlueprintNodeEditorCatalogEntry;
```

优先使用 `app.services.blueprintNodes`，除非需要查询 palette 或 catalog entry。

### story

```ts
listStories(): StoryLibraryEntry[];
getStoryEntry(storyId): StoryLibraryEntry | undefined;
getDefaultStoryId(): StoryId | undefined;
setDefaultStory(storyId): void;
createStory(name): StoryLibraryEntry;
renameStory(storyId, name): boolean;
deleteStory(storyId): boolean;
loadLibrary(): Promise<StoryLibraryIndex>;
getLibraryIndex(): StoryLibraryIndex;
onLibraryChanged(handler): () => void;
loadAnimationIndex(): Promise<StoryAnimationIndex>;
getAnimationIndex(): StoryAnimationIndex;
listAnimationAssets(): StoryAnimationIndexEntry[];
loadAnimationAsset(animationId): Promise<StoryAnimationAsset>;
getLoadedAnimationAsset(animationId): StoryAnimationAsset | undefined;
createAnimationAsset(input): Promise<StoryAnimationAsset>;
updateAnimationAsset(animationId, updater): StoryAnimationAsset;
deleteAnimationAsset(animationId): boolean;
onAnimationsChanged(handler): () => void;
registerPluginAction(registration): () => void;
unregisterPluginAction(actionId): boolean;
getPluginAction(actionId): StoryPluginActionRegistration | undefined;
listPluginActions(): StoryPluginActionRegistration[];
onPluginActionsChanged(handler): () => void;
loadStory(storyId): Promise<StoryDocument>;
getStoryDocument(storyId): StoryDocument;
saveStory(storyId): Promise<void>;
flushPendingChanges(): Promise<void>;
reloadStory(storyId): Promise<StoryDocument>;
onDocumentChanged(handler): () => void;
onDirtyChanged(handler): () => void;
isDirty(): boolean;
getRevision(): number;
createChapter(storyId, name): StoryChapter;
renameChapter(storyId, chapterId, name): boolean;
deleteChapter(storyId, chapterId): boolean;
moveChapter(storyId, chapterId, beforeChapterId): boolean;
createScene(storyId, input): StoryScene;
renameScene(storyId, sceneId, name): boolean;
updateScene(storyId, sceneId, patch): boolean;
deleteScene(storyId, sceneId): boolean;
moveScene(storyId, sceneId, target): boolean;
setEntryScene(storyId, sceneId): void;
insertBlock(storyId, sceneId, block, target): StoryBlock;
updateBlock(storyId, sceneId, blockId, payload): void;
deleteBlock(storyId, sceneId, blockId): void;
replaceScene(storyId, sceneId, scene): void;
moveBlock(storyId, sceneId, blockId, target): void;
canImportStoryPackage(): false;
canExportStoryPackage(): false;
```

Story plugin action：

```ts
type StoryPluginActionRegistration = {
  id: string;
  label: string;
  detail?: string;
  group?: string;
  createBlock: (input: {
    generateId: () => string;
    initialText?: string;
  }) => StoryBlock;
};
```

### character

```ts
getCharacter(id): Character | undefined;
listCharacter(): Character[];
createCharacter(name): Character;
renameCharacter(id, name): boolean;
deleteCharacter(id): boolean;
listGroups(): CharacterGroup[];
getGroup(id): CharacterGroup | undefined;
createGroup(name): CharacterGroup;
renameGroup(id, name): boolean;
deleteGroup(id): boolean;
assignCharacterToGroup(characterId, groupId?): boolean;
listCharactersByGroup(groupId?): Character[];
isDirty(): boolean;
flushPendingChanges(): Promise<void>;
```

### assets

```ts
getAssets(): AssetsMap;
list<T extends AssetType>(type): string[];
fetch<T extends AssetType>(asset): Promise<RequestStatus<AssetData<T>>>;
exists<T extends AssetType>(asset): boolean;
importLocalAssets<T extends AssetType>(type): Promise<RequestStatus<RequestStatus<Asset<T, "local">>[]>>;
importRemoteAsset<T extends AssetType>(type, url): Promise<RequestStatus<Asset<T, "remote">>>;
clearRemoteCache(assetId?): Promise<void>;
```

## 推荐创建模板

```ts
import { definePlugin } from "narraleaf-studio/plugin";

export default definePlugin({
  async setup(app) {
    const prefix = app.plugin.id;

    const disposeKeys = app.services.ui.keybindings.registerMany([
      {
        id: `${prefix}.command`,
        key: "cmd+shift+p",
        description: "Run plugin command",
        handler: () => app.services.ui.notifications.info("Command executed"),
      },
    ]);

    app.services.ui.actions.register({
      id: `${prefix}.action`,
      label: "Plugin Action",
      tooltip: "Run plugin action",
      onClick: () => app.services.ui.notifications.success("Action executed"),
      order: 900,
    });

    return () => {
      disposeKeys();
      app.services.ui.actions.unregister(`${prefix}.action`);
    };
  },
});
```

## 常见失败原因

| 现象 | 检查 |
| --- | --- |
| 安装失败 | `manifest.json` 不是合法 JSON，或 `id` / `version` / `entry` 校验失败。 |
| 授权后仍不能启用 | `manifest.version` 已变更，需要重新批准当前版本。 |
| workspace 不加载插件 | 插件不是 `enabled` 状态，或上次有 `lastError`。 |
| `import` 失败 | 入口不是 ESM，或打包后仍有未被处理的外部依赖。 |
| `definePlugin` 不可用 | 插件不在 workspace plugin runtime 中运行，或导入名不是 `narraleaf-studio/plugin`。 |
| 文件操作被拒绝 | manifest 权限路径、mode、recursive 或插件版本授权不匹配。 |
| action/panel/widget 覆盖内建项 | 贡献 ID 没有用插件 ID 前缀。 |

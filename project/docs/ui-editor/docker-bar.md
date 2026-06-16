# UI Editor Docker Bar API

Docker Bar 是 UI Surface Editor 底部的上下文工具条。它有两类入口：

- 无选中元素时显示 insert palette，用于选择要拖拽创建的 widget 类型。
- 选中元素时显示该 widget module 提供的快捷编辑项。

实现入口在 `src/renderer/lib/ui-editor/docker/UIEditorDockerBar.tsx`。公开给 widget module 和 palette 配置使用的类型在 `src/renderer/lib/ui-editor/widget-modules/`。

## Insert Palette API

Insert palette 由 `src/renderer/lib/ui-editor/widget-modules/insertPalette.ts` 维护。它是显式顺序列表，不从 `widgetModuleRegistry.list()` 自动生成，因此内部类型如 `nl.root` 不会出现在创建入口中。

```ts
export type InsertPalettePlacement = "primary" | "overflow";

export type InsertPaletteConfigEntry = {
    readonly type: string;
    readonly placement?: InsertPalettePlacement;
};

export type InsertPaletteEntry = {
    readonly module: UIWidgetModule;
    readonly placement: InsertPalettePlacement;
};
```

`DEFAULT_INSERT_PALETTE_CONFIG` 是默认创建入口配置：

```ts
export const DEFAULT_INSERT_PALETTE_CONFIG = [
    { type: "nl.container" },
    { type: "nl.text" },
    { type: "nl.image" },
    { type: "nl.button" },
    { type: "nl.list" },
] as const satisfies readonly InsertPaletteConfigEntry[];
```

配置字段：

- `type`: 已注册的 widget module type，例如 `nl.text`。
- `placement`: 可选。省略时等同于 `primary`。
- `primary`: 直接显示在 Docker Bar 主栏。
- `overflow`: 收进主栏最后的三个点按钮；点击后三点按钮上方显示垂直菜单，菜单项包含 icon 和 display name。

函数：

```ts
export function resolveInsertPaletteEntries(
    config: readonly InsertPaletteConfigEntry[],
    resolveModule?: (type: string) => UIWidgetModule | undefined,
): InsertPaletteEntry[];

export function listInsertPaletteEntries(): InsertPaletteEntry[];

export function listInsertPaletteModules(): UIWidgetModule[];
```

- `resolveInsertPaletteEntries` 用于把配置解析成真实 module entry；测试可传入自定义 `resolveModule`。
- `listInsertPaletteEntries` 给 Docker Bar 使用，保留 placement 信息。
- `listInsertPaletteModules` 是兼容旧调用的 API，只返回 module 列表，不返回 placement。
- 如果配置的 `type` 没有注册，会抛出 `[insertPalette] Missing widget module for palette type: ...`。

示例：把低频元素放进 overflow。

```ts
export const DEFAULT_INSERT_PALETTE_CONFIG = [
    { type: "nl.container" },
    { type: "nl.text" },
    { type: "nl.image" },
    { type: "nl.button", placement: "overflow" },
    { type: "nl.list", placement: "overflow" },
] as const satisfies readonly InsertPaletteConfigEntry[];
```

点击任一 insert entry 只会设置 editor tool：

```ts
stateService.setTool({ kind: "insert", nodeType: type });
```

实际创建仍由 interaction layer 的 drag-to-create 流程完成。

## Docker Bar Item API

选中元素时，widget module 通过 `createDockerBarItems` 返回 `DockerBarItem[]`。类型定义在 `src/renderer/lib/ui-editor/widget-modules/types.ts`。

```ts
export type DockerBarItem =
    | DockerBarButton
    | DockerBarSelect
    | DockerBarNumberInput
    | DockerBarSeparator;
```

### Button

```ts
export type DockerBarButton = {
    kind: "button";
    id: string;
    icon?: LucideIcon;
    label?: string;
    tooltip?: string;
    disabled?: boolean;
    active?: boolean;
    onClick: () => void;
};
```

Behavior:

- Renders as a compact toolbar button.
- `icon` is a Lucide icon component.
- `label` is optional; icon-only buttons are valid.
- `active` applies active styling.
- `disabled` prevents click handling and applies disabled styling.
- `tooltip` maps to the native `title`.

### Select

```ts
export type DockerBarSelect = {
    kind: "select";
    id: string;
    label?: string;
    tooltip?: string;
    value: string | number;
    options: { value: string | number; label: string }[];
    onChange: (value: string | number) => void;
};
```

Behavior:

- Renders as a compact select with a fixed-width shell.
- Menu is portaled and opens above the Docker Bar.
- Numeric-looking values are converted back to `number`; other values remain strings.
- `label` renders as a small left label.

### Number Input

```ts
export type DockerBarNumberInput = {
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
    inputProps?: InputHTMLAttributes<HTMLInputElement>;
};
```

Behavior:

- Uses `DeferredNumberInput`; `onChange` is called on commit.
- `min`, `max`, and `step` are passed to the input.
- `placeholder` is used for mixed multi-select values.
- `inputProps` can add native input props such as `title`.

### Separator

```ts
export type DockerBarSeparator = {
    kind: "separator";
    id: string;
};
```

Behavior:

- Renders as a thin vertical divider.
- Use a stable `id` so multi-select matching can compare item identity.

## Widget Module Hooks

Widget modules expose Docker Bar behavior through `UIWidgetModule`.

```ts
export type DockerBarContext = {
    element: UIElement;
    documentService: UIDocumentService;
};

export interface UIWidgetModule {
    readonly type: string;
    readonly displayName: string;
    readonly icon: LucideIcon;

    createDockerBarItems?(context: DockerBarContext): DockerBarItem[];
    createMultiSelectDockerBarItems?(context: DockerBarContext): DockerBarItem[];
}
```

`DockerBarContext` fields:

- `element`: the selected element for which items are being built.
- `documentService`: mutation API for updating layout, props, names, and document state.

Rules:

- Return `undefined` or an empty array to show no element-specific Docker Bar controls.
- Item `id` must be stable and unique within that module's Docker Bar output.
- Mutations should go through `documentService`.
- Keep handlers local to the current `element`; Docker Bar rebuilds on document changes.

Example:

```ts
export function createButtonDockerBarItems(ctx: DockerBarContext): DockerBarItem[] {
    const { element, documentService } = ctx;
    const props = getButtonProps(element);

    return [
        {
            kind: "number",
            id: "docker-button-pad-x",
            label: "Pad X",
            tooltip: "Horizontal padding",
            value: props.paddingX,
            min: 0,
            max: 128,
            step: 1,
            onChange: value => {
                documentService.updateElementProps(element.id, {
                    ...element.props,
                    paddingX: Math.max(0, value),
                });
            },
        },
    ];
}
```

## Runtime Behavior

`UIEditorDockerBar` chooses what to render from selection and tool state:

- Multi-select with compatible items: `MultiSelectDockerBar`.
- Single selected element with items and tool is not `insert`: `ElementDockerBar`.
- Otherwise: `PaletteDockerBar`.

Insert mode:

- Active insert type is `tool.kind === "insert" ? tool.nodeType : null`.
- Clicking the active insert entry toggles back to select mode.
- Clicking another insert entry switches to that insert type.
- The overflow menu only appears when overflow entries exist.

Overflow menu:

- Trigger is the final three-dot button in the palette row.
- Menu is portaled to `document.body`.
- Menu opens above the trigger with a gap and center-aligns to the trigger button.
- Outside click, Escape, and item selection close the menu.
- Pointer and mouse events are stopped so the canvas does not consume Docker Bar interactions.

Document updates:

- Docker Bar subscribes to `selectionChanged`, `toolChanged`, and `documentService.onDocumentChanged`.
- Width animates to measured content using `DockerBarAnimatedWidthShell`.

## Multi-Select Behavior

For multi-select, Docker Bar builds item groups for each selected element:

1. Use `createMultiSelectDockerBarItems` when present.
2. Fall back to `createDockerBarItems`.
3. If any selected element has no item group, no multi-select Docker Bar is shown.
4. Only items with matching `id` and `kind` across every selected element are shown.

Aggregation rules:

- `button`: clicking the aggregated button calls each source button unless that source is disabled. The aggregate is disabled only when every source is disabled.
- `select`: if all source values match, show that value. If values differ, show a mixed `"-"` option. Changing the select applies the new value to every source.
- `number`: if all source values match, show that value. If values differ, show a mixed placeholder and `NaN` value. Committing a number applies it to every source.
- `separator`: preserved from the base group.

Because matching is based on `id` and `kind`, shared controls should use the same stable ids across modules only when the same operation is safe for all selected elements.

## Built-In Docker Bar Providers

Current built-in providers:

- `nl.container`: layout kind, stack gap, stack axis, scroll axis.
- `nl.text`: font size and text alignment.
- `nl.image`: image fill mode plus shared rectangle controls.
- `nl.button`: horizontal padding.
- `nl.list`: item gap and editor preview count.

Shared helper:

- `createRectangleDockerBarItems(ctx, options?)` returns border radius and border width controls for rectangle-like widgets.

## Adding A Docker Bar Control

1. Add or update the widget module's `createDockerBarItems`.
2. Use a stable `id` prefixed by the widget or feature, for example `docker-text-font-size`.
3. Read current values from the widget's normalized helper.
4. Write changes through `documentService`.
5. If multi-select should behave differently, add `createMultiSelectDockerBarItems`; otherwise the single-select items are reused.

## Adding An Insert Entry

1. Register the widget module in `BuiltinWidgetModules` or another registry path.
2. Add its type to `DEFAULT_INSERT_PALETTE_CONFIG`.
3. Choose `placement: "primary"` for always-visible entries or `placement: "overflow"` for the three-dot menu.
4. Keep `listInsertPaletteModules()` users in mind: it returns all insertable modules regardless of placement.

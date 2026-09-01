/**
 * The Menu Bar side panel: the whole authoring surface for the shipped game's menu.
 *
 * Two halves, one above the other. The top is the bar as a tree - menus, their rows, and one level
 * of submenu - in the order the player will read it. The bottom is the selected row: what it says,
 * and what it does.
 *
 * Three decisions worth knowing before changing it:
 *
 *  - **Order is buttons, not dragging.** A menu is a short ordered list an author sets once, and a
 *    drag inside a panel this narrow is a gesture that misses more often than it lands.
 *  - **Unfinished rows stay visible and are marked.** An action with no page chosen is what a row
 *    looks like halfway through being built; the player never sees it (see `toGameMenuSpec`), and
 *    the panel says so rather than hiding the author's own work from them.
 *  - **Nothing shows an id.** A row is named by its label, and the ids in the document are the
 *    panel's own bookkeeping.
 *
 * Comments in English per project convention.
 */

import { useEffect, useMemo, useState } from "react";
import {
    ChevronDown,
    ChevronUp,
    CornerDownRight,
    List,
    Minus,
    Plus,
    Square,
    Trash2,
} from "lucide-react";
import { ui, type PluginApp, type PluginTranslator } from "narraleaf-studio/plugin";
import type { GameMenuAction, GameMenuDynamicSource } from "@shared/types/gameMenu";
import {
    MENU_BAR_ITEM_KINDS,
    isMenuBarItemComplete,
    type MenuBarItem,
    type MenuBarItemKind,
    type MenuBarLabel,
} from "./document";
import { useMenuBarTranslator } from "./messages";
import { samePath, type MenuBarPath, type MenuBarStore } from "./store";

/** Every action the author can pick, in the order the picker lists them. */
const ACTION_OPTIONS: { type: GameMenuAction["type"]; messageKey: string; skipValue?: boolean }[] = [
    { type: "openPage", messageKey: "actionOpenPage" },
    { type: "openLayer", messageKey: "actionOpenLayer" },
    { type: "quitToPage", messageKey: "actionQuitToPage" },
    { type: "quitApp", messageKey: "actionQuitApp" },
    { type: "next", messageKey: "actionNext" },
    { type: "toggleAutoForward", messageKey: "actionToggleAutoForward" },
    { type: "toggleSkipping", messageKey: "actionToggleSkipping" },
    { type: "setSkipReadText", messageKey: "actionSetSkipReadText", skipValue: true },
    { type: "setSkipReadText", messageKey: "actionSetSkipAllText", skipValue: false },
    { type: "toggleDialog", messageKey: "actionToggleDialog" },
    { type: "historyUndo", messageKey: "actionHistoryUndo" },
    { type: "historyRedo", messageKey: "actionHistoryRedo" },
    { type: "toggleFullscreen", messageKey: "actionToggleFullscreen" },
    { type: "fn", messageKey: "actionFn" },
];

const DYNAMIC_SOURCES: { source: GameMenuDynamicSource; messageKey: string }[] = [
    { source: "textLanguage", messageKey: "sourceTextLanguage" },
    { source: "voiceLanguage", messageKey: "sourceVoiceLanguage" },
    { source: "windowScale", messageKey: "sourceWindowScale" },
];

/** One picker value per row of {@link ACTION_OPTIONS}, so the two skip rows stay distinguishable. */
function actionOptionValue(option: { type: string; skipValue?: boolean }): string {
    return option.skipValue === undefined ? option.type : `${option.type}:${String(option.skipValue)}`;
}

function currentActionValue(action: GameMenuAction): string {
    return action.type === "setSkipReadText" ? `setSkipReadText:${String(action.value)}` : action.type;
}

function actionFromValue(value: string): GameMenuAction {
    const [type, flag] = value.split(":");
    switch (type) {
        case "openPage":
            return { type: "openPage", surfaceId: "" };
        case "openLayer":
            return { type: "openLayer", surfaceId: "", modal: true, dismissible: true, group: null };
        case "quitToPage":
            return { type: "quitToPage", surfaceId: "" };
        case "setSkipReadText":
            return { type: "setSkipReadText", value: flag === "true" };
        case "fn":
            return { type: "fn", fnRef: "", args: {} };
        default:
            return { type: type as Exclude<GameMenuAction["type"], "openPage" | "openLayer" | "quitToPage" | "setSkipReadText" | "fn"> };
    }
}

function itemKindIcon(kind: MenuBarItemKind) {
    if (kind === "separator") {
        return <Minus size={12} />;
    }
    if (kind === "dynamic") {
        return <List size={12} />;
    }
    if (kind === "submenu") {
        return <CornerDownRight size={12} />;
    }
    return <Square size={12} />;
}

export function MenuBarPanel({ app, store }: { app: PluginApp; store: MenuBarStore }) {
    const tr = useMenuBarTranslator(app);
    const [data, setData] = useState(() => store.getData());
    const [selected, setSelected] = useState<MenuBarPath | null>(null);
    const frozen = app.services.workspace.frozen;

    useEffect(() => store.subscribe(() => setData({ ...store.getData() })), [store]);

    const menuCount = data.menus.length;
    const summary = !data.enabled
        ? tr.t("summaryOff")
        : menuCount === 1
            ? tr.t("summaryOneMenu")
            : tr.t("summaryMenus", { count: menuCount });

    return (
        <ui.Panel.Root>
            <ui.Panel.Header title={tr.t("title")} description={summary} />
            <ui.Panel.Toolbar>
                <ui.Switch
                    checked={data.enabled}
                    disabled={frozen}
                    onCheckedChange={checked => void store.setEnabled(checked)}
                    aria-label={tr.t("enabled")}
                />
                <span className="text-xs text-fg-muted">{tr.t("enabled")}</span>
                <div className="ml-auto">
                    <ui.Button
                        size="sm"
                        variant="ghost"
                        disabled={frozen}
                        onClick={() => setSelected(store.addMenu(tr.t("newMenu")))}
                    >
                        <Plus size={13} />
                        {tr.t("addMenu")}
                    </ui.Button>
                </div>
            </ui.Panel.Toolbar>

            <div className="min-h-0 flex-1 overflow-y-auto">
                {menuCount === 0
                    ? (
                        <ui.Panel.EmptyState
                            title={tr.t("empty")}
                            description={tr.t("emptyHint")}
                        />
                    )
                    : (
                        <div className="space-y-2">
                            {data.menus.map(menu => (
                                <div key={menu.id} className="rounded border border-edge">
                                    <TreeRow
                                        depth={0}
                                        label={menu.label.text || tr.t("newMenu")}
                                        complete
                                        selected={samePath(selected, [menu.id])}
                                        onSelect={() => setSelected([menu.id])}
                                    />
                                    <div className="pb-1">
                                        {menu.items.map(item => (
                                            <ItemRows
                                                key={item.id}
                                                item={item}
                                                path={[menu.id, item.id]}
                                                depth={1}
                                                tr={tr}
                                                selected={selected}
                                                onSelect={setSelected}
                                            />
                                        ))}
                                        <div className="px-2 pt-1">
                                            <ui.Button
                                                size="sm"
                                                variant="ghost"
                                                disabled={frozen}
                                                onClick={() => setSelected(store.addItem([menu.id], "action", tr.t("newItem")))}
                                            >
                                                <Plus size={12} />
                                                {tr.t("addItem")}
                                            </ui.Button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
            </div>

            {selected && (
                <Inspector
                    app={app}
                    store={store}
                    tr={tr}
                    path={selected}
                    frozen={frozen}
                    onRemoved={() => setSelected(null)}
                    onSelect={setSelected}
                />
            )}
        </ui.Panel.Root>
    );
}

function TreeRow({
    depth,
    label,
    icon,
    complete,
    selected,
    onSelect,
}: {
    depth: number;
    label: string;
    icon?: React.ReactNode;
    complete: boolean;
    selected: boolean;
    onSelect: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onSelect}
            className={[
                "flex w-full min-w-0 items-center gap-2 px-2 py-1 text-left text-2xs",
                selected ? "bg-fill text-fg" : "text-fg-muted hover:bg-fill-subtle",
                depth === 0 ? "font-semibold" : "",
            ].join(" ")}
            style={{ paddingLeft: `${8 + depth * 14}px` }}
        >
            {icon && <span className="shrink-0 text-fg-subtle">{icon}</span>}
            <span className={["min-w-0 flex-1 truncate", complete ? "" : "italic text-fg-subtle"].join(" ")}>
                {label}
            </span>
        </button>
    );
}

function ItemRows({
    item,
    path,
    depth,
    tr,
    selected,
    onSelect,
}: {
    item: MenuBarItem;
    path: MenuBarPath;
    depth: number;
    tr: PluginTranslator;
    selected: MenuBarPath | null;
    onSelect: (path: MenuBarPath) => void;
}) {
    const label = item.kind === "separator"
        ? tr.t("kindSeparator")
        : item.kind === "dynamic"
            ? tr.t(DYNAMIC_SOURCES.find(entry => entry.source === item.source)?.messageKey ?? "kindDynamic")
            : item.label.text || tr.t("newItem");
    return (
        <>
            <TreeRow
                depth={depth}
                label={label}
                icon={itemKindIcon(item.kind)}
                complete={isMenuBarItemComplete(item)}
                selected={samePath(selected, path)}
                onSelect={() => onSelect(path)}
            />
            {item.kind === "submenu" && item.items.map(child => (
                <ItemRows
                    key={child.id}
                    item={child}
                    path={[...path, child.id]}
                    depth={depth + 1}
                    tr={tr}
                    selected={selected}
                    onSelect={onSelect}
                />
            ))}
        </>
    );
}

function Inspector({
    app,
    store,
    tr,
    path,
    frozen,
    onRemoved,
    onSelect,
}: {
    app: PluginApp;
    store: MenuBarStore;
    tr: PluginTranslator;
    path: MenuBarPath;
    frozen: boolean;
    onRemoved: () => void;
    onSelect: (path: MenuBarPath) => void;
}) {
    const node = store.find(path);
    const isMenu = path.length === 1;
    const item = !isMenu && node && "kind" in node ? node : null;

    const surfaces = useMemo(() => app.services.interface.listSurfaces(), [app]);
    const fns = useMemo(() => app.services.interface.listGlobalFns(), [app]);
    const keys = useMemo(() => app.services.localization.listKeys(), [app]);

    if (!node) {
        return null;
    }

    const label: MenuBarLabel | null = isMenu || (item && item.kind !== "separator" && item.kind !== "dynamic")
        ? (node as { label: MenuBarLabel }).label
        : null;

    return (
        <div className="mt-3 border-t border-edge pt-2">
            <ui.Panel.Section
                actions={(
                    <>
                        <ui.IconButton
                            size="sm"
                            variant="ghost"
                            aria-label={tr.t("moveUp")}
                            title={tr.t("moveUp")}
                            disabled={frozen}
                            onClick={() => store.move(path, -1)}
                        >
                            <ChevronUp size={13} />
                        </ui.IconButton>
                        <ui.IconButton
                            size="sm"
                            variant="ghost"
                            aria-label={tr.t("moveDown")}
                            title={tr.t("moveDown")}
                            disabled={frozen}
                            onClick={() => store.move(path, 1)}
                        >
                            <ChevronDown size={13} />
                        </ui.IconButton>
                        <ui.IconButton
                            size="sm"
                            variant="ghost"
                            aria-label={tr.t("remove")}
                            title={tr.t("remove")}
                            disabled={frozen}
                            onClick={() => {
                                store.remove(path);
                                onRemoved();
                            }}
                        >
                            <Trash2 size={13} />
                        </ui.IconButton>
                    </>
                )}
            >
                {label && (
                    <>
                        <ui.Panel.Row
                            label={tr.t("labelKey")}
                            control={(
                                <ui.Select
                                    size="sm"
                                    value={label.key ?? ""}
                                    disabled={frozen}
                                    placeholder={keys.length === 0 ? tr.t("noKeys") : tr.t("labelKeyNone")}
                                    options={[
                                        { value: "", label: tr.t("labelKeyNone") },
                                        ...keys.map(key => ({ value: key.name, label: key.name, secondaryLabel: key.sourceText })),
                                    ]}
                                    onChange={value => store.setLabel(path, { ...label, key: String(value) || null })}
                                />
                            )}
                        />
                        <ui.Panel.Row label={tr.t("labelText")} description={tr.t("labelTextHint")} />
                        <ui.Input
                            size="sm"
                            value={label.text}
                            disabled={frozen}
                            onChange={event => store.setLabel(path, { ...label, text: event.target.value })}
                        />
                    </>
                )}

                {item?.kind === "action" && (
                    <ActionEditor
                        action={item.action}
                        tr={tr}
                        frozen={frozen}
                        surfaces={surfaces}
                        fns={fns}
                        onChange={action => store.setAction(path, action)}
                    />
                )}

                {item?.kind === "dynamic" && (
                    <ui.Panel.Row
                        label={tr.t("source")}
                        description={tr.t("sourceHint")}
                        control={(
                            <ui.Select
                                size="sm"
                                value={item.source}
                                disabled={frozen}
                                options={DYNAMIC_SOURCES.map(entry => ({
                                    value: entry.source,
                                    label: tr.t(entry.messageKey),
                                }))}
                                onChange={value => store.setSource(path, value as GameMenuDynamicSource)}
                            />
                        )}
                    />
                )}

                {(isMenu || item?.kind === "submenu") && (
                    <div className="flex flex-wrap gap-1 pt-2">
                        {MENU_BAR_ITEM_KINDS.map(kind => (
                            <ui.Button
                                key={kind}
                                size="sm"
                                variant="ghost"
                                disabled={frozen}
                                onClick={() => onSelect(store.addItem(
                                    path,
                                    kind,
                                    kind === "submenu" ? tr.t("newSubmenu") : tr.t("newItem"),
                                ))}
                            >
                                <Plus size={12} />
                                {tr.t(kind === "action"
                                    ? "kindAction"
                                    : kind === "dynamic"
                                        ? "kindDynamic"
                                        : kind === "submenu" ? "kindSubmenu" : "kindSeparator")}
                            </ui.Button>
                        ))}
                    </div>
                )}

                {item && !isMenuBarItemComplete(item) && (
                    <div className="pt-2 text-2xs text-warning">{tr.t("incomplete")}</div>
                )}
                {frozen && <div className="pt-2 text-2xs text-fg-subtle">{tr.t("frozen")}</div>}
            </ui.Panel.Section>
        </div>
    );
}

function ActionEditor({
    action,
    tr,
    frozen,
    surfaces,
    fns,
    onChange,
}: {
    action: GameMenuAction;
    tr: PluginTranslator;
    frozen: boolean;
    surfaces: { id: string; name: string }[];
    fns: { fnRef: string; name: string; params: { pinId: string; name: string; valueType: string }[] }[];
    onChange: (action: GameMenuAction) => void;
}) {
    const needsSurface = action.type === "openPage" || action.type === "openLayer" || action.type === "quitToPage";
    const fn = action.type === "fn" ? fns.find(entry => entry.fnRef === action.fnRef) : undefined;
    return (
        <>
            <ui.Panel.Row
                label={tr.t("action")}
                control={(
                    <ui.Select
                        size="sm"
                        value={currentActionValue(action)}
                        disabled={frozen}
                        options={ACTION_OPTIONS.map(option => ({
                            value: actionOptionValue(option),
                            label: tr.t(option.messageKey),
                        }))}
                        onChange={value => onChange(actionFromValue(String(value)))}
                    />
                )}
            />
            {needsSurface && (
                <ui.Panel.Row
                    label={tr.t("page")}
                    control={(
                        <ui.Select
                            size="sm"
                            value={action.surfaceId}
                            disabled={frozen}
                            placeholder={tr.t("pageNone")}
                            options={surfaces.map(surface => ({ value: surface.id, label: surface.name }))}
                            onChange={value => onChange({ ...action, surfaceId: String(value) })}
                        />
                    )}
                />
            )}
            {action.type === "openLayer" && (
                <>
                    <ui.Panel.Row
                        label={tr.t("modal")}
                        control={(
                            <ui.Switch
                                checked={action.modal === true}
                                disabled={frozen}
                                onCheckedChange={checked => onChange({ ...action, modal: checked })}
                                aria-label={tr.t("modal")}
                            />
                        )}
                    />
                    <ui.Panel.Row
                        label={tr.t("dismissible")}
                        control={(
                            <ui.Switch
                                checked={action.dismissible !== false}
                                disabled={frozen}
                                onCheckedChange={checked => onChange({ ...action, dismissible: checked })}
                                aria-label={tr.t("dismissible")}
                            />
                        )}
                    />
                </>
            )}
            {action.type === "fn" && (
                <>
                    <ui.Panel.Row
                        label={tr.t("fn")}
                        description={fns.length === 0 ? tr.t("fnEmpty") : undefined}
                        control={(
                            <ui.Select
                                size="sm"
                                value={action.fnRef}
                                disabled={frozen || fns.length === 0}
                                placeholder={tr.t("fnNone")}
                                options={fns.map(entry => ({ value: entry.fnRef, label: entry.name }))}
                                // The arguments belong to the function that was chosen, so switching
                                // function drops them rather than carrying pin ids the new head has
                                // never heard of.
                                onChange={value => onChange({ type: "fn", fnRef: String(value), args: {} })}
                            />
                        )}
                    />
                    {fn && fn.params.length > 0 && (
                        <ui.Panel.Section title={tr.t("fnArgs")}>
                            {fn.params.map(param => (
                                <ui.Panel.Row
                                    key={param.pinId}
                                    label={param.name}
                                    description={param.valueType}
                                    control={(
                                        <ui.Input
                                            size="sm"
                                            value={String(action.args?.[param.pinId] ?? "")}
                                            disabled={frozen}
                                            onChange={event => onChange({
                                                ...action,
                                                args: {
                                                    ...action.args,
                                                    [param.pinId]: coerceArg(event.target.value, param.valueType),
                                                },
                                            })}
                                        />
                                    )}
                                />
                            ))}
                        </ui.Panel.Section>
                    )}
                </>
            )}
        </>
    );
}

/**
 * Type the author's typing to the pin that will receive it.
 *
 * Text is what a panel can offer for every pin type, and a function that declared an integer
 * parameter has to be handed a number - a string "3" reaching an arithmetic node is the kind of
 * failure that shows up as a wrong answer rather than an error. Anything unparseable stays the
 * string it was typed as, which is what the author sees in the box.
 */
function coerceArg(raw: string, valueType: string): unknown {
    if (valueType === "boolean") {
        return raw.trim().toLowerCase() === "true";
    }
    if (valueType === "integer" || valueType === "float") {
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : raw;
    }
    return raw;
}
